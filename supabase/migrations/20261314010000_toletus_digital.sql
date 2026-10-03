-- Gateway 1.6.0: a digital da Toletus cadastrada pela ficha do aluno.
--
-- 1. O número que a nuvem dá ao aluno no equipamento passa a vir de um
--    contador por academia. Antes era o maior número da academia mais um, e
--    bastava um cartão vinculado à mão (Toletus e Intelbras mandam o número
--    do cartão, com até dez dígitos) para todo aluno novo nascer com um
--    número de dez dígitos — que o leitor de digital da Toletus não guarda
--    (o número vai em 2 bytes, e a capacidade é de 3.000 digitais). O
--    contador só sobe: o número de quem saiu não é dado a outro, e um
--    equipamento sem remoção remota não reconhece uma pessoa pela digital
--    que ficou de outra.
--
-- 2. Trocar o número do aluno na ficha (o cartão no lugar da digital, por
--    exemplo) agenda a remoção do número antigo nos equipamentos. Antes a
--    digital antiga ficava no leitor, sem uso — dado biométrico guardado sem
--    finalidade. E o número digitado à mão também empurra o contador.
--
-- 3. A recusa de ordem a Gateway sem gestão remota cita as marcas de hoje.

create table public.organizacao_numeracao_catraca (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ultimo integer not null default 0 check (ultimo >= 0),
  updated_at timestamptz not null default now()
);

alter table public.organizacao_numeracao_catraca enable row level security;
-- Sem regra nenhuma, de propósito: só proximo_identificador_catraca, que é
-- security definer, lê e grava. Um gestor que pudesse mexer no contador
-- poderia empurrá-lo para fora do que o leitor de digital guarda.
revoke all on public.organizacao_numeracao_catraca from anon, authenticated;

comment on table public.organizacao_numeracao_catraca is
  'Último número que a nuvem deu a um aluno nos equipamentos da academia. Só sobe; número de cartão vinculado à mão não conta.';

-- Ponto de partida de quem já deu números: o maior número que cabe no leitor
-- de digital (até 65535). Número maior é de cartão e não conta.
insert into public.organizacao_numeracao_catraca (organization_id, ultimo)
select organization_id, max(identificador_catraca::integer)
  from public.alunos
 where identificador_catraca ~ '^\d{1,5}$' and identificador_catraca::integer <= 65535
 group by organization_id
on conflict (organization_id) do nothing;

create or replace function public.proximo_identificador_catraca(_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  insert into public.organizacao_numeracao_catraca (organization_id) values (_org)
  on conflict (organization_id) do nothing;
  -- A linha travada serializa dois cadastros simultâneos na mesma academia.
  select ultimo into v_n from public.organizacao_numeracao_catraca where organization_id = _org for update;
  loop
    v_n := v_n + 1;
    -- Pula o número que alguém já tem (um cartão vinculado à mão, por exemplo).
    exit when not exists (
      select 1 from public.alunos where organization_id = _org and identificador_catraca = v_n::text
    );
  end loop;
  update public.organizacao_numeracao_catraca set ultimo = v_n, updated_at = now() where organization_id = _org;
  return v_n::text;
end;
$$;

revoke all on function public.proximo_identificador_catraca(uuid) from public, anon, authenticated;
grant execute on function public.proximo_identificador_catraca(uuid) to service_role;

create or replace function public.numero_catraca_alterado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Número que cabe no leitor, gravado por qualquer caminho (a ficha, a
  -- importação, a nuvem), empurra o contador: um número digitado à mão e
  -- depois trocado não pode voltar a ser dado a outro aluno, porque a
  -- digital antiga pode ter ficado num equipamento sem remoção remota.
  if new.identificador_catraca ~ '^\d{1,5}$' and new.identificador_catraca::integer <= 65535 then
    insert into public.organizacao_numeracao_catraca (organization_id, ultimo)
    values (new.organization_id, new.identificador_catraca::integer)
    on conflict (organization_id) do update
      set ultimo = greatest(organizacao_numeracao_catraca.ultimo, excluded.ultimo), updated_at = now()
      where organizacao_numeracao_catraca.ultimo < excluded.ultimo;
  end if;

  -- Troca de um número por outro: o antigo sai dos equipamentos. Limpar o
  -- número (retirada da autorização, anonimização) já agenda a remoção no
  -- próprio caminho, e por isso não passa por aqui.
  if tg_op = 'UPDATE' and old.identificador_catraca is not null and new.identificador_catraca is not null
     and new.identificador_catraca <> old.identificador_catraca then
    perform public.agendar_remocao_equipamento(
      old.organization_id, old.id, old.identificador_catraca,
      exists (select 1 from public.aluno_consentimento_biometrico where aluno_id = old.id),
      'número do aluno trocado na ficha');
  end if;
  return null;
end;
$$;

create trigger trg_numero_catraca_alterado
  after insert or update of identificador_catraca on public.alunos
  for each row execute function public.numero_catraca_alterado();

revoke execute on function public.numero_catraca_alterado() from public, anon, authenticated;

create or replace function public.solicitar_comando_gateway(_catraca_id uuid, _tipo text, _parametros jsonb DEFAULT '{}'::jsonb, _aluno_id uuid DEFAULT NULL::uuid, _motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cat public.organizacao_catracas;
  v_tel public.gateway_telemetria;
  v_aluno public.alunos;
  v_params jsonb := '{}'::jsonb;
  v_user_id text;
  v_expira interval;
  v_id uuid;
  v_arkefit boolean;
begin
  select * into v_cat from public.organizacao_catracas where id = _catraca_id;
  if v_cat.id is null then
    raise exception 'Catraca não encontrada.';
  end if;

  v_arkefit := public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke');
  if not (v_arkefit
          or public.has_org_role(v_uid, v_cat.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_cat.organization_id, 'recepcao')) then
    raise exception 'Só a gestão ou a recepção da academia (ou a ArkeFit) enviam ordens ao Gateway.' using errcode = '42501';
  end if;

  if _tipo not in ('sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
                   'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto') then
    -- apagar_usuario só nasce da revogação, da exclusão ou da anonimização,
    -- que conferem o motivo; não é botão. enviar_foto_rosto nasce da foto
    -- que o próprio aluno manda pelo app (enviar_foto_rosto()).
    raise exception 'Ordem desconhecida: %', _tipo;
  end if;

  if v_cat.status is distinct from 'ativo' then
    raise exception 'Esta catraca está desativada no ARKE.';
  end if;

  select * into v_tel from public.gateway_telemetria where catraca_id = _catraca_id;
  if v_tel.catraca_id is null or not (_tipo = any (v_tel.capacidades)) then
    raise exception '%', case
      when v_tel.catraca_id is null then
        'Este Gateway ainda não reportou à nuvem. Atualize o Gateway Local para a versão 1.0.'
      when _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto') then
        'Este Gateway não tem a gestão remota do equipamento configurada no config.json (Control iD, leitores faciais Topdata, Intelbras e a digital da Toletus).'
      else 'Este Gateway não aceita esta ordem.'
    end;
  end if;

  if _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto')
     and v_tel.reportado_em < now() - interval '3 minutes' then
    raise exception 'O Gateway está sem sinal agora. Esta ordem precisa de resposta na hora — confira o computador da catraca.';
  end if;

  if _tipo in ('cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto') then
    select * into v_aluno from public.alunos where id = _aluno_id;
    if v_aluno.id is null or v_aluno.organization_id <> v_cat.organization_id then
      raise exception 'Aluno não encontrado nesta academia.';
    end if;
    if v_aluno.anonimizado_em is not null then
      raise exception 'Aluno anonimizado não é cadastrado no equipamento.';
    end if;
  end if;

  case _tipo
    when 'liberar_catraca' then
      if length(btrim(coalesce(_motivo, ''))) < 3 then
        raise exception 'Informe o motivo da liberação — fica registrado.';
      end if;
      v_params := jsonb_build_object(
        'sentido', case when _parametros->>'sentido' in ('entrada', 'saida', 'ambos') then _parametros->>'sentido' else 'entrada' end,
        'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '2 minutes';

    when 'cadastrar_usuario' then
      v_user_id := v_aluno.identificador_catraca;
      if v_user_id is null then
        -- Próximo número livre desta academia. Corrida entre dois cadastros
        -- simultâneos cai no índice único na conclusão, que devolve erro
        -- claro em vez de dois alunos com o mesmo número.
        v_user_id := public.proximo_identificador_catraca(v_cat.organization_id);
      end if;
      if v_user_id !~ '^\d{1,15}$' then
        raise exception 'O identificador atual deste aluno (%) não é numérico; os equipamentos só aceitam número.', v_user_id;
      end if;
      v_params := jsonb_build_object('user_id', v_user_id, 'nome', 'Aluno',
                                     'matricula', left(v_aluno.id::text, 8));
      v_expira := interval '10 minutes';

    when 'cadastrar_digital' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes da digital.';
      end if;
      if not public.aluno_consentiu_biometria(v_aluno.id) then
        raise exception 'O aluno ainda não autorizou o uso da digital — no app (Perfil → Privacidade) ou pelo termo impresso assinado. A LGPD exige o consentimento dele antes do cadastro.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    when 'cadastrar_rosto' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes do rosto.';
      end if;
      if not public.aluno_consentiu_rosto(v_aluno.id) then
        raise exception 'O aluno ainda não autorizou o uso do rosto — no app (Perfil → Privacidade) ou pelo termo impresso assinado. A LGPD exige o consentimento dele antes do cadastro.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    when 'cadastrar_cartao' then
      if v_aluno.identificador_catraca is null then
        raise exception 'Cadastre o aluno no equipamento antes do cartão.';
      end if;
      v_params := jsonb_build_object('user_id', v_aluno.identificador_catraca,
                                     'equipamento', nullif(_parametros->>'equipamento', ''));
      v_expira := interval '5 minutes';

    else
      v_expira := interval '10 minutes';
  end case;

  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, aluno_id, motivo, solicitado_por, expira_em)
  values (v_cat.organization_id, _catraca_id, _tipo, v_params, _aluno_id, nullif(btrim(coalesce(_motivo, '')), ''), v_uid, now() + v_expira)
  returning id into v_id;

  if _tipo = 'liberar_catraca' then
    insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
    select v_uid, u.email, 'catraca.liberacao_remota', 'organizacao_catracas', _catraca_id, o.nome,
           jsonb_build_object('comando_id', v_id, 'motivo', _motivo, 'sentido', v_params->>'sentido', 'catraca', v_cat.nome)
      from public.organizations o
      left join auth.users u on u.id = v_uid
     where o.id = v_cat.organization_id;
  end if;

  return v_id;
end;
$function$;

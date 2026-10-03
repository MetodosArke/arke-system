-- Cadastro do rosto pelo ARKE (Gateway 1.3.0).
--
-- Decisões do responsável de 02/10/2026: um consentimento só para digital e
-- rosto, e o rosto cadastrado também por foto enviada pelo próprio aluno no
-- app, além da câmera do equipamento.
--
-- Dois caminhos, duas ordens ao Gateway:
--   * cadastrar_rosto: a recepção dispara pela ficha, com o aluno na frente
--     do leitor, e a câmera do equipamento captura. O rosto não passa pela
--     nuvem;
--   * enviar_foto_rosto: o aluno manda a foto pelo app, e o Gateway a
--     entrega a cada leitor facial da academia. A foto passa pela nuvem, e
--     por isso o caminho dela é curto e vigiado:
--       - mora em fotos_rosto_pendentes, que nenhum papel lê pela API (nem
--         a equipe, nem o aluno): só a função do canal de ordens a entrega
--         ao Gateway;
--       - sai quando nenhuma ordem aberta a usa mais (concluída, falhou,
--         expirou) e, no máximo, em 24 horas — sem Storage, porque o banco
--         consegue apagar uma linha sozinho e um arquivo não;
--       - a ordem guarda só o número da foto, nunca a foto.
--
-- O rosto só entra com uma autorização cujo TEXTO cobre o rosto.
-- aluno_consentiu_rosto() exige a autorização vigente e que a versão vigente
-- do texto seja a que fala de rosto (versao_consentimento_rosto()). Até o
-- texto novo ser aprovado e publicado, a versão vigente é a de 23/09, que só
-- fala de digital: nenhum rosto entra, por construção.

alter table public.gateway_comandos drop constraint gateway_comandos_tipo_check;
alter table public.gateway_comandos add constraint gateway_comandos_tipo_check check (tipo = any (array[
  'sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
  'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto', 'enviar_foto_rosto',
  'apagar_usuario'
]));

-- A primeira versão do texto da autorização que fala de rosto. Quando o
-- texto for publicado, versao_consentimento_biometrico() passa a ser ela (ou
-- uma posterior) e esta função acompanha se a data mudar.
create or replace function public.versao_consentimento_rosto()
returns text
language sql
immutable
set search_path = public
as $$ select '2026-10-03'::text $$;

create or replace function public.aluno_consentiu_rosto(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- A mesma regra de visibilidade da digital (aluno_consentiu_biometria),
  -- e o texto vigente precisa ser um que fala de rosto.
  select public.aluno_consentiu_biometria(_aluno_id)
     and public.versao_consentimento_biometrico() >= public.versao_consentimento_rosto();
$$;

revoke all on function public.aluno_consentiu_rosto(uuid) from public, anon;
grant execute on function public.aluno_consentiu_rosto(uuid) to authenticated, service_role;

create table public.fotos_rosto_pendentes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  -- JPEG em base64, como os leitores pedem (Topdata: até ~150 KB, 480x640).
  foto text not null check (foto like 'data:image/jpeg;base64,%' and length(foto) between 2000 and 400000),
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '24 hours'
);

comment on table public.fotos_rosto_pendentes is
  'Foto do rosto enviada pelo aluno no app, de passagem até o Gateway a entregar às catracas. Nenhum papel lê pela API; sai quando a ordem fecha ou em 24 h (limpar_fotos_rosto_sem_uso).';

create index fotos_rosto_pendentes_aluno_idx on public.fotos_rosto_pendentes (aluno_id);
create index fotos_rosto_pendentes_org_idx on public.fotos_rosto_pendentes (organization_id);

-- RLS ligada e nenhuma regra: ninguém lê nem escreve pela API. Quem grava é
-- enviar_foto_rosto() e quem lê é o canal de ordens, com a service_role.
alter table public.fotos_rosto_pendentes enable row level security;
revoke all on public.fotos_rosto_pendentes from anon, authenticated;
grant select, insert, delete on public.fotos_rosto_pendentes to service_role;

create or replace function public.limpar_fotos_rosto_sem_uso()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.fotos_rosto_pendentes f
   where f.expira_em < now()
      or not exists (
        select 1 from public.gateway_comandos c
         where c.tipo = 'enviar_foto_rosto'
           and c.parametros->>'foto_id' = f.id::text
           and c.status in ('pendente', 'entregue')
      );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.limpar_fotos_rosto_sem_uso() from public, anon, authenticated;
grant execute on function public.limpar_fotos_rosto_sem_uso() to service_role;

-- O próximo número livre da academia no equipamento. Era a conta de dentro
-- de solicitar_comando_gateway(); a foto pelo app também precisa dela.
create or replace function public.proximo_identificador_catraca(_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce(max(identificador_catraca::bigint), 0) + 1)::text
    from public.alunos
   where organization_id = _org and identificador_catraca ~ '^\d{1,15}$';
$$;

revoke all on function public.proximo_identificador_catraca(uuid) from public, anon, authenticated;
grant execute on function public.proximo_identificador_catraca(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.registrar_telemetria_gateway(_catraca_id uuid, _tel jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_ant public.gateway_telemetria;
  v_estado text := nullif(_tel->>'estado', '');
  v_erro_em timestamptz;
  v_sync timestamptz;
  v_gap interval;
  v_min numeric;
  v_caps text[];
  v_conhecidas text[] := array[
    'sincronizar_completo', 'enviar_logs', 'diagnostico', 'liberar_catraca',
    'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao', 'cadastrar_rosto', 'enviar_foto_rosto', 'apagar_usuario'
  ];
begin
  select organization_id into v_org from public.organizacao_catracas where id = _catraca_id;
  if v_org is null or _tel is null or jsonb_typeof(_tel) <> 'object' then
    return;
  end if;
  if v_estado is not null and v_estado not in ('online', 'contingencia', 'offline') then
    v_estado := null;
  end if;
  -- Datas vindas de fora: valor torto vira nulo, nunca derruba o registro.
  begin v_erro_em := nullif(_tel->>'ultimo_erro_em', '')::timestamptz; exception when others then v_erro_em := null; end;
  begin v_sync := nullif(_tel->>'ultima_sincronizacao', '')::timestamptz; exception when others then v_sync := null; end;

  select coalesce(array_agg(x), '{}') into v_caps
    from jsonb_array_elements_text(
      case when jsonb_typeof(_tel->'capacidades') = 'array' then _tel->'capacidades' else '[]'::jsonb end
    ) x
   where x = any (v_conhecidas);

  select * into v_ant from public.gateway_telemetria where catraca_id = _catraca_id;

  if v_ant.catraca_id is null then
    insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
    values (_catraca_id, v_org, 'conectou',
            'Gateway ' || coalesce(nullif(_tel->>'versao', ''), '(versão não informada)') || ' passou a reportar à nuvem.');
  else
    v_gap := now() - v_ant.reportado_em;
    if v_gap > interval '3 minutes' then
      v_min := round(extract(epoch from v_gap) / 60);
      insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
      values (_catraca_id, v_org, 'voltou',
              'Voltou depois de ' ||
              case when v_min >= 120 then round(v_min / 60, 1)::text || ' h' else v_min::text || ' min' end ||
              ' sem sinal.');
    end if;
    if v_estado is not null and v_estado is distinct from v_ant.estado then
      if v_estado = 'contingencia' then
        insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
        values (_catraca_id, v_org, 'contingencia', 'Decidindo pelo cache local — a nuvem não respondeu a tempo.');
      elsif v_estado = 'online' and v_ant.estado in ('contingencia', 'offline') then
        insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe)
        values (_catraca_id, v_org, 'normalizou', 'Voltou a validar na nuvem.');
      end if;
    end if;
  end if;

  if v_erro_em is not null and (v_ant.ultimo_erro_em is null or v_erro_em > v_ant.ultimo_erro_em) then
    insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe, ocorrido_em)
    values (_catraca_id, v_org, 'erro', left(coalesce(_tel->>'ultimo_erro', ''), 300), least(v_erro_em, now()));
  end if;

  insert into public.gateway_telemetria as t (
    catraca_id, organization_id, versao, modelo, estado, fila_offline, cache_alunos,
    ultima_sincronizacao, ultimo_erro, ultimo_erro_em, equipamentos, ponte, capacidades, reportado_em
  ) values (
    _catraca_id, v_org,
    left(nullif(_tel->>'versao', ''), 40),
    left(nullif(_tel->>'modelo', ''), 40),
    v_estado,
    case when _tel->>'fila_offline' ~ '^\d{1,9}$' then (_tel->>'fila_offline')::int else 0 end,
    case when _tel->>'cache_alunos' ~ '^\d{1,9}$' then (_tel->>'cache_alunos')::int else 0 end,
    v_sync,
    left(nullif(_tel->>'ultimo_erro', ''), 500),
    v_erro_em,
    case when jsonb_typeof(_tel->'equipamentos') = 'array' then _tel->'equipamentos' else '[]'::jsonb end,
    case when jsonb_typeof(_tel->'ponte') = 'object' then _tel->'ponte' else null end,
    v_caps,
    now()
  )
  on conflict (catraca_id) do update set
    versao = excluded.versao,
    modelo = excluded.modelo,
    estado = excluded.estado,
    fila_offline = excluded.fila_offline,
    cache_alunos = excluded.cache_alunos,
    ultima_sincronizacao = coalesce(excluded.ultima_sincronizacao, t.ultima_sincronizacao),
    ultimo_erro = coalesce(excluded.ultimo_erro, t.ultimo_erro),
    ultimo_erro_em = coalesce(excluded.ultimo_erro_em, t.ultimo_erro_em),
    equipamentos = excluded.equipamentos,
    ponte = excluded.ponte,
    capacidades = excluded.capacidades,
    reportado_em = now();

  -- O carimbo antigo continua valendo para quem só lê organizacao_catracas;
  -- a escrita é freada porque a escuta longa chama isto a cada ~20 s.
  update public.organizacao_catracas
     set ultimo_heartbeat_em = now()
   where id = _catraca_id
     and (ultimo_heartbeat_em is null or ultimo_heartbeat_em < now() - interval '30 seconds');
end;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_comando_gateway(_catraca_id uuid, _tipo text, _parametros jsonb DEFAULT '{}'::jsonb, _aluno_id uuid DEFAULT NULL::uuid, _motivo text DEFAULT NULL::text)
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
        'Este Gateway não tem a gestão remota do equipamento configurada (disponível para Control iD, leitores faciais Topdata e, para liberar, Toletus).'
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

CREATE OR REPLACE FUNCTION public.concluir_comando_gateway(_catraca_id uuid, _comando_id uuid, _sucesso boolean, _resultado jsonb, _erro text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.gateway_comandos;
begin
  update public.gateway_comandos
     set status = case when _sucesso then 'concluido' else 'falhou' end,
         concluido_em = now(),
         resultado = _resultado,
         erro = case when _sucesso then null else left(coalesce(nullif(_erro, ''), 'Falhou sem detalhe.'), 500) end
   where id = _comando_id and catraca_id = _catraca_id and status = 'entregue'
  returning * into c;
  if c.id is null then
    -- Resultado de comando que não é deste Gateway, ou que já foi fechado
    -- (expirado, ou resultado repetido): ignorado em silêncio de propósito.
    return;
  end if;

  if c.tipo = 'cadastrar_usuario' and _sucesso and c.aluno_id is not null then
    begin
      update public.alunos
         set identificador_catraca = c.parametros->>'user_id'
       where id = c.aluno_id and organization_id = c.organization_id;
    exception when unique_violation then
      update public.gateway_comandos
         set status = 'falhou',
             erro = 'O número ' || (c.parametros->>'user_id') || ' já pertence a outro aluno desta academia.'
       where id = c.id;
    end;
  elsif c.tipo = 'enviar_foto_rosto' then
    -- A foto já cumpriu o papel (ou não vai cumprir): sai do banco quando
    -- nenhuma ordem aberta a usa mais.
    perform public.limpar_fotos_rosto_sem_uso();
  elsif c.tipo = 'liberar_catraca' and _sucesso then
    insert into public.acessos_catraca_logs (organization_id, catraca_id, aluno_id, cpf_consultado, resultado, confirmado_por)
    values (c.organization_id, c.catraca_id, null, 'remoto', 'liberado_remoto', c.solicitado_por);
  elsif c.tipo = 'apagar_usuario' then
    if _sucesso then
      perform public.verificar_remocao_concluida(c.lote);
    else
      perform public.abrir_tarefa_remocao_equipamento(
        c.organization_id, c.aluno_id, c.parametros->>'user_id', 'equipamento:' || coalesce(c.lote, c.id)::text, c.motivo);
    end if;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.expirar_comandos_gateway(_catraca_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.gateway_comandos;
  n integer := 0;
begin
  for r in
    update public.gateway_comandos c
       set status = 'expirado', concluido_em = now(),
           erro = coalesce(c.erro, 'Não chegou ao Gateway dentro do prazo — ele estava sem sinal.')
     where c.status = 'pendente' and c.expira_em < now()
       and (_catraca_id is null or c.catraca_id = _catraca_id)
    returning c.*
  loop
    n := n + 1;
    if r.tipo = 'apagar_usuario' then
      perform public.abrir_tarefa_remocao_equipamento(
        r.organization_id, r.aluno_id, r.parametros->>'user_id', 'equipamento:' || coalesce(r.lote, r.id)::text, r.motivo);
    end if;
  end loop;

  for r in
    update public.gateway_comandos c
       set status = 'falhou', concluido_em = now(),
           erro = 'O Gateway recebeu a ordem e não devolveu resultado.'
     where c.status = 'entregue' and c.entregue_em < now() - interval '10 minutes'
       and (_catraca_id is null or c.catraca_id = _catraca_id)
    returning c.*
  loop
    n := n + 1;
    if r.tipo = 'apagar_usuario' then
      perform public.abrir_tarefa_remocao_equipamento(
        r.organization_id, r.aluno_id, r.parametros->>'user_id', 'equipamento:' || coalesce(r.lote, r.id)::text, r.motivo);
    end if;
  end loop;
  perform public.limpar_fotos_rosto_sem_uso();
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revogar_consentimento_biometrico(_aluno_id uuid)
 RETURNS TABLE(identificador_catraca text, organization_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_identificador text;
begin
  select a.organization_id, a.identificador_catraca
    into v_org, v_identificador
    from public.alunos a where a.id = _aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)
          or exists (select 1 from public.alunos a
                      where a.id = _aluno_id and a.user_id = auth.uid())) then
    raise exception 'Só a equipe da academia, a ArkeFit ou o próprio aluno podem revogar o consentimento biométrico.';
  end if;

  update public.aluno_consentimento_biometrico c
     set revogado_em = now(), revogado_por = auth.uid()
   where c.aluno_id = _aluno_id and c.revogado_em is null;

  -- O identificador sai junto: sem ele o ARKE não reconhece mais o aluno
  -- pela catraca, nem pela digital que ainda esteja no equipamento enquanto
  -- a remoção não acontece.
  update public.alunos a
     set identificador_catraca = null
   where a.id = _aluno_id;

  -- A foto do rosto que ainda não chegou às catracas não segue viagem.
  update public.gateway_comandos c
     set status = 'expirado', concluido_em = now(), erro = 'Autorização retirada antes da entrega.'
   where c.aluno_id = _aluno_id and c.tipo = 'enviar_foto_rosto' and c.status = 'pendente';
  delete from public.fotos_rosto_pendentes f where f.aluno_id = _aluno_id;

  if v_identificador is not null then
    perform public.agendar_remocao_equipamento(
      v_org, _aluno_id, v_identificador, true, 'consentimento biométrico revogado');
  end if;

  return query select v_identificador, v_org;
end;
$function$;

-- A foto do rosto que o próprio aluno manda pelo app. Só ele: foto de rosto
-- é dado biométrico, e quem autoriza e envia é o titular.
create or replace function public.enviar_foto_rosto(_aluno_id uuid, _foto text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
  v_foto uuid;
  v_lote uuid := gen_random_uuid();
  v_ident text;
  v_n integer := 0;
  v_tentativa integer := 0;
  r record;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null or v_aluno.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio aluno envia a foto do rosto.' using errcode = '42501';
  end if;
  if v_aluno.anonimizado_em is not null then
    raise exception 'Cadastro anonimizado não recebe foto.';
  end if;
  if not public.situacao_permite_app(v_aluno.situacao_academia, v_aluno.situacao_academia_em) then
    raise exception 'Fale com a recepção da academia antes de cadastrar o rosto.';
  end if;
  if not public.aluno_consentiu_rosto(_aluno_id) then
    raise exception 'Autorize antes o uso do rosto na catraca, em Perfil → Privacidade.';
  end if;
  if _foto is null or _foto not like 'data:image/jpeg;base64,%' or length(_foto) < 2000 or length(_foto) > 400000 then
    raise exception 'A foto precisa ser um JPEG de até 300 KB. Tire de novo pelo app.';
  end if;
  -- Freio: cinco fotos por dia bastam para quem está acertando o enquadramento.
  if (select count(distinct c.parametros->>'foto_id')
        from public.gateway_comandos c
       where c.aluno_id = _aluno_id and c.tipo = 'enviar_foto_rosto'
         and c.solicitado_em > now() - interval '24 hours') >= 5 then
    raise exception 'Você já enviou cinco fotos hoje. Tente de novo amanhã ou peça ajuda na recepção.';
  end if;
  if not exists (
    select 1 from public.organizacao_catracas c
      join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
       and 'enviar_foto_rosto' = any (t.capacidades)
  ) then
    raise exception 'A sua academia ainda não tem catraca com leitor facial ligada ao ArkeFit.';
  end if;

  -- A foto anterior que ainda não chegou às catracas é trocada pela nova.
  update public.gateway_comandos
     set status = 'expirado', concluido_em = now(), erro = 'Trocada por uma foto nova.'
   where aluno_id = _aluno_id and tipo = 'enviar_foto_rosto' and status = 'pendente';

  -- O leitor cria o aluno junto com a foto. O número sai daqui, pela mesma
  -- conta do cadastro pela ficha; dois cadastros ao mesmo tempo esbarram no
  -- índice único, e a tentativa seguinte pega o número de depois.
  v_ident := v_aluno.identificador_catraca;
  while v_ident is null loop
    v_tentativa := v_tentativa + 1;
    begin
      v_ident := public.proximo_identificador_catraca(v_aluno.organization_id);
      update public.alunos set identificador_catraca = v_ident where id = _aluno_id;
    exception when unique_violation then
      v_ident := null;
      if v_tentativa >= 3 then
        raise exception 'Não foi possível reservar o número do aluno no equipamento agora. Tente de novo.';
      end if;
    end;
  end loop;

  insert into public.fotos_rosto_pendentes (organization_id, aluno_id, foto)
  values (v_aluno.organization_id, _aluno_id, _foto)
  returning id into v_foto;

  for r in
    select c.id
      from public.organizacao_catracas c
      join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
       and 'enviar_foto_rosto' = any (t.capacidades)
  loop
    insert into public.gateway_comandos
      (organization_id, catraca_id, tipo, parametros, aluno_id, lote, solicitado_por, expira_em)
    values
      (v_aluno.organization_id, r.id, 'enviar_foto_rosto',
       jsonb_build_object('user_id', v_ident, 'foto_id', v_foto),
       _aluno_id, v_lote, auth.uid(), now() + interval '24 hours');
    v_n := v_n + 1;
  end loop;

  -- A foto trocada sai agora, se nenhuma catraca a estiver recebendo.
  perform public.limpar_fotos_rosto_sem_uso();
  return v_n;
end;
$$;

revoke all on function public.enviar_foto_rosto(uuid, text) from public, anon;
grant execute on function public.enviar_foto_rosto(uuid, text) to authenticated;

-- O que o app do aluno e a ficha mostram sobre o rosto: se a academia tem
-- leitor facial, se a autorização cobre o rosto e como foi o último envio.
-- Nada da foto em si.
create or replace function public.get_cadastro_rosto(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
  v_ultimo public.gateway_comandos;
  v_ultimo_json jsonb := null;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null
     or not (v_aluno.user_id = auth.uid()
             or public.is_org_staff(auth.uid(), v_aluno.organization_id)
             or public.has_role(auth.uid(), 'superadmin')
             or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Aluno não encontrado.' using errcode = '42501';
  end if;

  select * into v_ultimo
    from public.gateway_comandos
   where aluno_id = _aluno_id and tipo in ('enviar_foto_rosto', 'cadastrar_rosto')
   order by solicitado_em desc
   limit 1;

  if v_ultimo.id is not null then
    select jsonb_build_object(
             'tipo', v_ultimo.tipo,
             'enviado_em', v_ultimo.solicitado_em,
             'catracas', count(*),
             'pendentes', count(*) filter (where c.status in ('pendente', 'entregue')),
             'concluidas', count(*) filter (where c.status = 'concluido'),
             'falhas', count(*) filter (where c.status in ('falhou', 'expirado')),
             'erro', (array_agg(c.erro order by c.concluido_em desc nulls last) filter (where c.erro is not null))[1]
           )
      into v_ultimo_json
      from public.gateway_comandos c
     where (v_ultimo.lote is not null and c.lote = v_ultimo.lote)
        or (v_ultimo.lote is null and c.id = v_ultimo.id);
  end if;

  return jsonb_build_object(
    'foto_pelo_app', exists (
      select 1 from public.organizacao_catracas c
        join public.gateway_telemetria t on t.catraca_id = c.id
       where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
         and 'enviar_foto_rosto' = any (t.capacidades)),
    'texto_cobre_rosto', public.versao_consentimento_biometrico() >= public.versao_consentimento_rosto(),
    'autorizado', public.aluno_consentiu_rosto(_aluno_id),
    'ultimo', v_ultimo_json
  );
end;
$$;

revoke all on function public.get_cadastro_rosto(uuid) from public, anon;
grant execute on function public.get_cadastro_rosto(uuid) to authenticated;

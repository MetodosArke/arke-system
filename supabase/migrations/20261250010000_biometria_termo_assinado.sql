-- Digital de aluno sem app: termo impresso e assinado (decisão do
-- responsável, 23/09/2026).
--
-- Desde 20261245010000 só o próprio aluno autoriza o uso da digital, pelo
-- app — a equipe vê e não registra, porque consentimento dado por terceiro
-- não é consentimento (LGPD art. 11, I). Faltava o aluno que não usa o app.
-- O caminho é o do papel: a recepção imprime o termo (o mesmo texto e a
-- mesma versão da tela do app), o aluno assina, e a recepção anexa o termo
-- assinado. Quem consente continua sendo o titular — a assinatura é dele;
-- a equipe só registra, e o arquivo é a prova.
--
-- O resto do ciclo fica com a gestão e a recepção, também por decisão do
-- responsável: cadastro no equipamento, digital, cartão e exclusão. A
-- autorização pelo app continua valendo, para quem usa o app.

alter table public.aluno_consentimento_biometrico
  add column if not exists origem text not null default 'app',
  add column if not exists registrado_por uuid,
  add column if not exists termo_arquivo text;

alter table public.aluno_consentimento_biometrico
  drop constraint if exists aluno_consentimento_biometrico_origem_check;
alter table public.aluno_consentimento_biometrico
  add constraint aluno_consentimento_biometrico_origem_check
  check (origem in ('app', 'termo_assinado')
         and (origem = 'app' or (termo_arquivo is not null and registrado_por is not null)));

comment on column public.aluno_consentimento_biometrico.origem is
  'app: o aluno autorizou no app. termo_assinado: o aluno assinou o termo impresso e a recepção anexou (termo_arquivo, no bucket termos-biometria).';

-- ── Onde o termo assinado fica ─────────────────────────────────────────────
-- Bucket privado, pasta <organização>/<aluno>/. Leem o próprio aluno e a
-- equipe da academia (a mesma regra dos atestados); gravam só gestão e
-- recepção. Ninguém altera nem apaga: é prova de consentimento, e apagá-la
-- deixaria o registro sem base.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('termos-biometria', 'termos-biometria', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public = false,
       file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.pode_gravar_termo_biometria(_caminho text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.alunos a
     where a.organization_id::text = split_part(_caminho, '/', 1)
       and a.id::text = split_part(_caminho, '/', 2)
       and (public.has_org_role(auth.uid(), a.organization_id, 'gestor')
            or public.has_org_role(auth.uid(), a.organization_id, 'recepcao'))
  );
$$;
revoke execute on function public.pode_gravar_termo_biometria(text) from public, anon;
grant execute on function public.pode_gravar_termo_biometria(text) to authenticated;

-- As regras de storage.objects são uma por operação (22/09/2026): o bucket
-- novo entra nas existentes, e não numa regra a mais — uma segunda regra
-- permissiva se somaria por OU e poderia abrir o que as outras fecham.
alter policy "objetos: leitura" on storage.objects using (
  (bucket_id = any (array['avatars', 'email-assets', 'exercicio-videos', 'exercicio-imagens', 'feed-images']))
  or ((bucket_id = any (array['atestados', 'chat-videos', 'termos-biometria'])) and public.pode_acessar_atestado(name))
);

alter policy "objetos: inclusão" on storage.objects with check (
  ((bucket_id = 'avatars') and ((storage.foldername(name))[1] = (auth.uid())::text))
  or ((bucket_id = 'feed-images') and ((storage.foldername(name))[1] = (auth.uid())::text))
  or ((bucket_id = any (array['exercicio-videos', 'exercicio-imagens'])) and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
  or ((bucket_id = any (array['atestados', 'chat-videos'])) and public.pode_acessar_atestado(name))
  or ((bucket_id = 'termos-biometria') and public.pode_gravar_termo_biometria(name))
);

-- ── Registrar a autorização pelo termo ─────────────────────────────────────
create or replace function public.registrar_consentimento_biometria_termo(_aluno_id uuid, _termo_arquivo text)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_uid uuid := auth.uid();
  v_aluno public.alunos;
  v_id uuid;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null then
    raise exception 'Aluno não encontrado.';
  end if;
  if not (public.has_org_role(v_uid, v_aluno.organization_id, 'gestor')
          or public.has_org_role(v_uid, v_aluno.organization_id, 'recepcao')) then
    raise exception 'Só a gestão ou a recepção da academia registram o termo assinado.' using errcode = '42501';
  end if;
  if v_aluno.anonimizado_em is not null then
    raise exception 'Aluno anonimizado não tem digital cadastrada.';
  end if;
  if v_aluno.situacao_academia is distinct from 'em_dia' then
    raise exception 'Só aluno em dia com a academia tem a digital cadastrada.';
  end if;
  -- O arquivo precisa estar onde a regra de acesso o protege, e existir:
  -- registro apontando para arquivo nenhum não prova nada.
  if _termo_arquivo is null
     or split_part(_termo_arquivo, '/', 1) <> v_aluno.organization_id::text
     or split_part(_termo_arquivo, '/', 2) <> v_aluno.id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'termos-biometria' and o.name = _termo_arquivo) then
    raise exception 'Anexe o termo assinado pelo aluno antes de registrar a autorização.';
  end if;

  -- Mesmo desenho de consentir_biometria(): a autorização anterior é
  -- encerrada, não reescrita — ela prova o que foi aceito naquela data.
  update public.aluno_consentimento_biometrico
     set revogado_em = now(), revogado_por = v_uid
   where aluno_id = _aluno_id and revogado_em is null;

  insert into public.aluno_consentimento_biometrico
    (organization_id, aluno_id, versao_texto, origem, registrado_por, termo_arquivo)
  values
    (v_aluno.organization_id, _aluno_id, public.versao_consentimento_biometrico(), 'termo_assinado', v_uid, _termo_arquivo)
  returning id into v_id;

  insert into public.auditoria_acoes_sensiveis (ator_user_id, ator_email, acao, entidade, entidade_id, organizacao_nome, detalhes)
  select v_uid, u.email, 'biometria.consentimento_por_termo', 'aluno_consentimento_biometrico', v_id, o.nome,
         jsonb_build_object('aluno_id', _aluno_id, 'versao', public.versao_consentimento_biometrico(), 'arquivo', _termo_arquivo)
    from public.organizations o
    left join auth.users u on u.id = v_uid
   where o.id = v_aluno.organization_id;

  return v_id;
end;
$$;
revoke execute on function public.registrar_consentimento_biometria_termo(uuid, text) from public, anon;
grant execute on function public.registrar_consentimento_biometria_termo(uuid, text) to authenticated;

-- ── solicitar_comando_gateway: "Aluno" no display e a mensagem dos dois caminhos
-- O display da Control iD passa a mostrar "Aluno" em vez do nome (decisão
-- do responsável): quem está na fila atrás não vê o nome de ninguém.
create or replace function public.solicitar_comando_gateway(
  _catraca_id uuid, _tipo text, _parametros jsonb default '{}'::jsonb, _aluno_id uuid default null, _motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
                   'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
    -- apagar_usuario só nasce da revogação, da exclusão ou da anonimização,
    -- que conferem o motivo; não é botão.
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
      when _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
        'Este Gateway não tem a gestão remota do equipamento configurada (disponível para Control iD).'
      else 'Este Gateway não aceita esta ordem.'
    end;
  end if;

  if _tipo in ('liberar_catraca', 'cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao')
     and v_tel.reportado_em < now() - interval '3 minutes' then
    raise exception 'O Gateway está sem sinal agora. Esta ordem precisa de resposta na hora — confira o computador da catraca.';
  end if;

  if _tipo in ('cadastrar_usuario', 'cadastrar_digital', 'cadastrar_cartao') then
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
        select (coalesce(max(identificador_catraca::bigint), 0) + 1)::text into v_user_id
          from public.alunos
         where organization_id = v_cat.organization_id and identificador_catraca ~ '^\d{1,15}$';
      end if;
      if v_user_id !~ '^\d{1,15}$' then
        raise exception 'O identificador atual deste aluno (%) não é numérico; a Control iD só aceita número.', v_user_id;
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
$$;

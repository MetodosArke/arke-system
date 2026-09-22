-- Rodada 5: termos de uso, política de privacidade e contrato da academia
-- (licença + tratamento de dados), com registro do aceite.
--
-- O texto mora no repositório (src/content/legal) e é versionado pelo git;
-- aqui fica a versão publicada e o hash SHA-256 do texto, para o aceite provar
-- qual texto exato foi aceito. Nova versão = nova linha; a plataforma pede
-- novo aceite a todos.

create type public.tipo_documento_legal as enum ('termos_uso', 'privacidade', 'contrato_academia');

create table public.documentos_legais (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_documento_legal not null,
  versao text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  publicado_em timestamptz not null default now(),
  unique (tipo, versao)
);

comment on table public.documentos_legais is
  'Versões publicadas dos documentos legais (texto em src/content/legal). Global da plataforma, sem organization_id, como planos_atacado.';

insert into public.documentos_legais (tipo, versao, sha256) values
  ('termos_uso', '2026-09-22', '3de05425d29933b44fe0a0f6803bd0d0d6903ed4574bbb824c55ad354a2f9899'),
  ('privacidade', '2026-09-22', 'a4da5b1a743899e25292bf5fe10ca19a0a2fa2b66f8031940d57070069ad4ef9'),
  ('contrato_academia', '2026-09-22', '33e61005ddcbe2858c1cc28a429783eedd312e7fe3831157944b18b81c755d7b');

alter table public.documentos_legais enable row level security;

-- Público: as páginas /termos e /privacidade abrem sem login. Os privilégios
-- padrão do projeto não dão SELECT ao anon em tabela nova — a regra sozinha
-- não bastaria.
grant select on public.documentos_legais to anon;
create policy "leitura" on public.documentos_legais
  for select to anon, authenticated using (true);
create policy "inclusão" on public.documentos_legais
  for insert to authenticated
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "alteração" on public.documentos_legais
  for update to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
create policy "exclusão" on public.documentos_legais
  for delete to authenticated
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));

-- Aceites. Termos e privacidade são da pessoa (organization_id nulo); o
-- contrato é da academia, aceito por um gestor em nome dela.
create table public.aceites_documentos (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_legais(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  aceito_em timestamptz not null default now(),
  user_agent text
);

create unique index aceites_documentos_unico
  on public.aceites_documentos (documento_id, user_id, coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index aceites_documentos_org on public.aceites_documentos (organization_id) where organization_id is not null;

comment on table public.aceites_documentos is
  'Registro do aceite dos documentos legais. Só nasce por registrar_aceite() (ou pela matrícula pública, com a service_role); não tem política de escrita.';

alter table public.aceites_documentos enable row level security;

-- Cada um vê os próprios; o gestor vê os aceites do contrato da academia; a
-- ArkeFit vê todos. Escrita só pelas funções abaixo — aceite é prova, não
-- pode ser editado.
create policy "leitura" on public.aceites_documentos
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_role((select auth.uid()), 'superadmin')
    or public.has_role((select auth.uid()), 'admin_arke')
    or (organization_id is not null and public.has_org_role((select auth.uid()), organization_id, 'gestor'))
  );

create or replace function public.documento_legal_vigente(_tipo public.tipo_documento_legal)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.documentos_legais where tipo = _tipo order by publicado_em desc limit 1;
$$;

create or replace function public.registrar_aceite(
  _tipo public.tipo_documento_legal,
  _organization_id uuid default null,
  _user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_doc uuid := public.documento_legal_vigente(_tipo);
  v_org uuid := null;
begin
  if v_uid is null then
    raise exception 'Faça login para registrar o aceite.' using errcode = '42501';
  end if;
  if _tipo = 'contrato_academia' then
    if _organization_id is null or not public.has_org_role(v_uid, _organization_id, 'gestor') then
      raise exception 'Só o gestor aceita o contrato em nome da academia.' using errcode = '42501';
    end if;
    v_org := _organization_id;
  end if;
  insert into public.aceites_documentos (documento_id, user_id, organization_id, user_agent)
  values (v_doc, v_uid, v_org, left(_user_agent, 300))
  on conflict do nothing;
  return v_doc;
end;
$$;

revoke execute on function public.registrar_aceite(public.tipo_documento_legal, uuid, text) from public, anon;
grant execute on function public.registrar_aceite(public.tipo_documento_legal, uuid, text) to authenticated;

-- O que falta a pessoa aceitar para seguir: termos e privacidade vigentes e,
-- para o gestor de academia fora de trial, o contrato vigente da academia.
-- A ArkeFit não passa por aqui.
create or replace function public.get_aceites_pendentes(_organization_id uuid default null)
returns table (tipo text, versao text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.has_role(v_uid, 'superadmin') or public.has_role(v_uid, 'admin_arke') then
    return;
  end if;

  return query
  select d.tipo::text, d.versao
    from public.documentos_legais d
   where d.id in (public.documento_legal_vigente('termos_uso'), public.documento_legal_vigente('privacidade'))
     and not exists (select 1 from public.aceites_documentos a where a.documento_id = d.id and a.user_id = v_uid);

  if _organization_id is not null
     and public.has_org_role(v_uid, _organization_id, 'gestor')
     and exists (select 1 from public.organizations o where o.id = _organization_id and o.status <> 'trial') then
    return query
    select d.tipo::text, d.versao
      from public.documentos_legais d
     where d.id = public.documento_legal_vigente('contrato_academia')
       and not exists (select 1 from public.aceites_documentos a
                        where a.documento_id = d.id and a.organization_id = _organization_id);
  end if;
end;
$$;

revoke execute on function public.get_aceites_pendentes(uuid) from public, anon;
grant execute on function public.get_aceites_pendentes(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Onboarding: sexta etapa, o contrato
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.onboarding_etapas_interno(_organization_id uuid)
returns table (etapa text, concluida boolean, detalhe text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  o public.organizations%rowtype;
  v_doc text;
  v_faltando text[] := '{}';
  v_n int;
begin
  select * into o from public.organizations where id = _organization_id;
  if not found then
    return;
  end if;

  v_doc := regexp_replace(coalesce(o.cnpj_cpf, ''), '\D', '', 'g');
  if length(v_doc) not in (11, 14) then v_faltando := array_append(v_faltando, 'CNPJ'); end if;
  if length(v_doc) = 14 and coalesce(btrim(o.razao_social), '') = '' then v_faltando := array_append(v_faltando, 'razão social'); end if;
  if coalesce(btrim(o.email_contato), '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v_faltando := array_append(v_faltando, 'e-mail'); end if;
  if length(regexp_replace(coalesce(o.telefone, ''), '\D', '', 'g')) < 10 then v_faltando := array_append(v_faltando, 'celular'); end if;
  if length(regexp_replace(coalesce(o.cep, ''), '\D', '', 'g')) <> 8 then v_faltando := array_append(v_faltando, 'CEP'); end if;
  if coalesce(btrim(o.logradouro), '') = '' or coalesce(btrim(o.numero), '') = '' or coalesce(btrim(o.bairro), '') = ''
     or coalesce(btrim(o.cidade), '') = '' or o.uf is null then
    v_faltando := array_append(v_faltando, 'endereço');
  end if;
  etapa := 'dados';
  concluida := cardinality(v_faltando) = 0;
  detalhe := case when concluida then null else 'Falta: ' || array_to_string(v_faltando, ', ') end;
  return next;

  etapa := 'recebimentos';
  concluida := o.asaas_wallet_id is not null;
  detalhe := case
    when o.asaas_wallet_id is null then 'Conta Asaas ainda não configurada'
    when o.asaas_conta_origem = 'criada' and coalesce(o.asaas_conta_status, '') <> 'APPROVED'
      then 'Conta criada — aprovação do Asaas: ' || coalesce(o.asaas_conta_status, 'aguardando')
    else null
  end;
  return next;

  select count(*) into v_n from public.planos_academia where organization_id = _organization_id and ativo;
  etapa := 'planos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' plano(s) ativo(s)' else 'Nenhum plano ativo' end;
  return next;

  select count(*) into v_n from public.organization_members
   where organization_id = _organization_id and status = 'active' and role in ('professor', 'nutricionista', 'recepcao');
  etapa := 'equipe';
  concluida := v_n > 0 or o.onboarding_equipe_dispensada;
  detalhe := case when v_n > 0 then v_n || ' pessoa(s) na equipe'
                  when o.onboarding_equipe_dispensada then 'Sem equipe além do gestor'
                  else 'Nenhum membro cadastrado' end;
  return next;

  select count(*) into v_n from public.alunos where organization_id = _organization_id and anonimizado_em is null;
  etapa := 'alunos';
  concluida := v_n > 0;
  detalhe := case when v_n > 0 then v_n || ' aluno(s)' else 'Nenhum aluno cadastrado' end;
  return next;

  etapa := 'contrato';
  concluida := exists (select 1 from public.aceites_documentos a
                        where a.organization_id = _organization_id
                          and a.documento_id = public.documento_legal_vigente('contrato_academia'));
  detalhe := case when concluida then 'Aceito' else 'Contrato ainda não aceito' end;
  return next;
end;
$$;

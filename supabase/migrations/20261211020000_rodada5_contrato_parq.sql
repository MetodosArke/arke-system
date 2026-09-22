-- Rodada 5, segunda parte: contrato de matrícula da academia com assinatura
-- eletrônica, PAR-Q e atestado médico com validade e alerta de vencimento.
-- Proteção jurídica que a academia hoje faz no papel.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Contrato de matrícula (texto da academia, versionado)
-- ─────────────────────────────────────────────────────────────────────────
create table public.contratos_matricula (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  versao integer not null,
  titulo text not null default 'Contrato de matrícula',
  conteudo text not null check (length(btrim(conteudo)) >= 50),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id) on delete set null,
  unique (organization_id, versao)
);

-- Um contrato ativo por academia: publicar uma versão nova aposenta a anterior.
create unique index contratos_matricula_um_ativo on public.contratos_matricula (organization_id) where ativo;

comment on table public.contratos_matricula is
  'Contrato de matrícula da academia com o aluno. Nunca é editado: cada mudança é uma versão nova (publicar_contrato_matricula), para a assinatura provar qual texto foi assinado.';

alter table public.contratos_matricula enable row level security;

create policy "leitura" on public.contratos_matricula
  for select to authenticated
  using (public.is_org_member((select auth.uid()), organization_id));
-- Escrita só pela função de publicação (sem políticas de escrita).

create or replace function public.publicar_contrato_matricula(_organization_id uuid, _titulo text, _conteudo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_versao int;
  v_id uuid;
begin
  if not public.has_org_role(auth.uid(), _organization_id, 'gestor') then
    raise exception 'Só o gestor publica o contrato de matrícula.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_conteudo, ''))) < 50 then
    raise exception 'O contrato está curto demais para ser publicado.' using errcode = '23514';
  end if;
  select coalesce(max(versao), 0) + 1 into v_versao from public.contratos_matricula where organization_id = _organization_id;
  update public.contratos_matricula set ativo = false where organization_id = _organization_id and ativo;
  insert into public.contratos_matricula (organization_id, versao, titulo, conteudo, criado_por)
  values (_organization_id, v_versao, coalesce(nullif(btrim(_titulo), ''), 'Contrato de matrícula'), _conteudo, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.publicar_contrato_matricula(uuid, text, text) from public, anon;
grant execute on function public.publicar_contrato_matricula(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Assinatura eletrônica do aluno
-- ─────────────────────────────────────────────────────────────────────────
-- Assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I): quem assinou
-- (a conta autenticada), o nome digitado, quando, em qual navegador, e o hash
-- SHA-256 do texto exato assinado.
create table public.aluno_assinaturas_contrato (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  contrato_id uuid not null references public.contratos_matricula(id),
  nome_digitado text not null,
  sha256 text not null,
  assinado_em timestamptz not null default now(),
  user_agent text,
  unique (aluno_id, contrato_id)
);

alter table public.aluno_assinaturas_contrato enable row level security;

create policy "leitura" on public.aluno_assinaturas_contrato
  for select to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
  );
-- Escrita só por assinar_contrato_matricula (assinatura é prova, não se edita).

create or replace function public.assinar_contrato_matricula(_aluno_id uuid, _contrato_id uuid, _nome text, _user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_aluno public.alunos%rowtype;
  v_contrato public.contratos_matricula%rowtype;
  v_id uuid;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if not found or v_aluno.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio aluno assina o contrato.' using errcode = '42501';
  end if;
  select * into v_contrato from public.contratos_matricula where id = _contrato_id;
  if not found or v_contrato.organization_id <> v_aluno.organization_id or not v_contrato.ativo then
    raise exception 'Este contrato não está mais vigente. Recarregue a página.' using errcode = '23514';
  end if;
  if length(btrim(coalesce(_nome, ''))) < 3 then
    raise exception 'Digite o seu nome completo para assinar.' using errcode = '23514';
  end if;
  insert into public.aluno_assinaturas_contrato (organization_id, aluno_id, contrato_id, nome_digitado, sha256, user_agent)
  values (v_aluno.organization_id, v_aluno.id, v_contrato.id, btrim(_nome),
          encode(digest(v_contrato.conteudo, 'sha256'), 'hex'), left(_user_agent, 300))
  on conflict (aluno_id, contrato_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.assinar_contrato_matricula(uuid, uuid, text, text) from public, anon;
grant execute on function public.assinar_contrato_matricula(uuid, uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. PAR-Q e atestado (dados de saúde)
-- ─────────────────────────────────────────────────────────────────────────
-- As 7 perguntas do PAR-Q+. Qualquer "sim" pede atestado médico antes de
-- treinar (em SP, a Lei 16.724/2018 aceita o PAR-Q sem "sim" no lugar do
-- atestado). Dado sensível: o aluno e a equipe da academia leem; a ArkeFit não.
create table public.aluno_parq (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade unique,
  respostas jsonb not null check (jsonb_typeof(respostas) = 'array' and jsonb_array_length(respostas) = 7),
  algum_sim boolean generated always as (respostas @> '[true]'::jsonb) stored,
  respondido_em timestamptz not null default now(),
  atestado_caminho text,
  atestado_validade date,
  atestado_registrado_por uuid references auth.users(id) on delete set null,
  atestado_registrado_em timestamptz
);

alter table public.aluno_parq enable row level security;

create policy "leitura" on public.aluno_parq
  for select to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
  );
create policy "inclusão" on public.aluno_parq
  for insert to authenticated
  with check (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()) and a.organization_id = aluno_parq.organization_id)
    or public.is_org_staff((select auth.uid()), organization_id)
  );
create policy "alteração" on public.aluno_parq
  for update to authenticated
  using (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()))
    or public.is_org_staff((select auth.uid()), organization_id)
  )
  with check (
    aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid()) and a.organization_id = aluno_parq.organization_id)
    or public.is_org_staff((select auth.uid()), organization_id)
  );
create policy "exclusão" on public.aluno_parq
  for delete to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id));

-- Atestado: arquivo privado, na pasta <organization_id>/<aluno_id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atestados', 'atestados', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.pode_acessar_atestado(_caminho text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.alunos a
     where a.organization_id::text = split_part(_caminho, '/', 1)
       and a.id::text = split_part(_caminho, '/', 2)
       and (a.user_id = auth.uid() or public.is_org_staff(auth.uid(), a.organization_id))
  );
$$;

create policy "atestados: leitura" on storage.objects
  for select to authenticated
  using (bucket_id = 'atestados' and public.pode_acessar_atestado(name));
create policy "atestados: envio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'atestados' and public.pode_acessar_atestado(name));
create policy "atestados: troca" on storage.objects
  for update to authenticated
  using (bucket_id = 'atestados' and public.pode_acessar_atestado(name));
create policy "atestados: exclusão" on storage.objects
  for delete to authenticated
  using (bucket_id = 'atestados' and public.pode_acessar_atestado(name));

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Alerta de atestado (tarefa na fila)
-- ─────────────────────────────────────────────────────────────────────────
alter type public.tarefa_tipo add value if not exists 'atestado';

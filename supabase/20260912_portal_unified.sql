-- Arke Etapa 2: migração unificada e idempotente do portal
-- Executar no SQL Editor do projeto Supabase. Não insere dados de teste.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  username text not null unique,
  module text not null check (module in ('academia','studio','profissional','aluno','administrador')),
  role text not null,
  status text not null default 'Ativo' check (status in ('Ativo','Suspenso')),
  logo_url text,
  profile_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  academy text not null,
  plan text not null,
  status text not null default 'Ativo' check (status in ('Ativo','Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_invitations (
  id uuid primary key default gen_random_uuid(), email text not null, name text not null,
  username text not null, module text not null, role text not null,
  status text not null default 'pending', token_hash text, expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.app_password_resets (
  id uuid primary key default gen_random_uuid(), email text not null, token_hash text not null,
  expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.asaas_webhook_events (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  event text not null, payload jsonb not null, received_at timestamptz not null default now()
);
create table if not exists public.asaas_payments (
  id uuid primary key default gen_random_uuid(), external_id text not null unique,
  customer_id text, status text, value numeric(12,2), due_date date, description text,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.acervo_exercicios (
  id uuid primary key default gen_random_uuid(), nome text not null, grupo_muscular text not null,
  descricao text, instrucoes text, video_url text, imagem_url text, equipamento text,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.acervo_grupos_musculares (
  id uuid primary key default gen_random_uuid(), nome text not null unique, ordem integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.acervo_modelos_treino (
  id uuid primary key default gen_random_uuid(), titulo text not null, categoria text not null default '', descricao text,
  divisoes jsonb not null default '[]'::jsonb, criado_por uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.acervo_planos_alimentares (
  id uuid primary key default gen_random_uuid(), titulo text not null, categoria text not null default '', objetivo text,
  descricao text, instrucoes text, criado_por uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.acervo_rotinas (
  id uuid primary key default gen_random_uuid(), titulo text not null, categoria text not null default '', descricao text, rotina text not null,
  criado_por uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.acervo_acesso_regras (
  id uuid primary key default gen_random_uuid(), modulo text not null, plano text not null,
  habilitado boolean not null default false, requer_consultoria boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(modulo, plano)
);

create table if not exists public.saas_organizations (
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.app_users(id) on delete restrict,
  name text not null, slug text not null unique, module text not null, plan text not null,
  status text not null default 'trial', logo_url text, primary_color text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.saas_units (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  name text not null, slug text not null, city text, status text not null default 'active', created_at timestamptz not null default now(), unique(organization_id, slug)
);
create table if not exists public.saas_memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade, role text not null default 'viewer', status text not null default 'active', created_at timestamptz not null default now(), unique(organization_id, auth_user_id)
);
create table if not exists public.saas_subscriptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  plan text not null, status text not null default 'trialing', billing_cycle text not null default 'monthly', amount_cents integer not null default 0,
  provider text not null default 'asaas', external_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.saas_module_policies (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  unit_id uuid references public.saas_units(id) on delete cascade, role text not null, module text not null,
  can_view boolean not null default false, can_manage boolean not null default false, unique(organization_id, unit_id, role, module)
);
create table if not exists public.saas_onboarding (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.saas_organizations(id) on delete cascade,
  current_step integer not null default 1, status text not null default 'not_started', city text, invite_email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.saas_audit_logs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null, action text not null, entity text not null, entity_id uuid,
  before_json jsonb, after_json jsonb, created_at timestamptz not null default now()
);

create index if not exists idx_app_students_status on public.app_students(status);
create index if not exists idx_app_users_module_status on public.app_users(module, status);
create index if not exists idx_saas_org_client on public.saas_organizations(client_id);
create index if not exists idx_saas_membership_user on public.saas_memberships(auth_user_id);
create index if not exists idx_saas_audit_org_created on public.saas_audit_logs(organization_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.app_students enable row level security;
alter table public.app_invitations enable row level security;
alter table public.app_password_resets enable row level security;
alter table public.asaas_webhook_events enable row level security;
alter table public.asaas_payments enable row level security;
alter table public.acervo_exercicios enable row level security;
alter table public.acervo_grupos_musculares enable row level security;
alter table public.acervo_modelos_treino enable row level security;
alter table public.acervo_planos_alimentares enable row level security;
alter table public.acervo_rotinas enable row level security;
alter table public.acervo_acesso_regras enable row level security;
alter table public.saas_organizations enable row level security;
alter table public.saas_units enable row level security;
alter table public.saas_memberships enable row level security;
alter table public.saas_subscriptions enable row level security;
alter table public.saas_module_policies enable row level security;
alter table public.saas_onboarding enable row level security;
alter table public.saas_audit_logs enable row level security;

-- O backend usa service_role; estas políticas tornam o acesso do cliente explicitamente restrito.
do $$ begin
  create policy app_users_self_read on public.app_users for select to authenticated using (auth_user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy saas_membership_self_read on public.saas_memberships for select to authenticated using (auth_user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy saas_org_member_read on public.saas_organizations for select to authenticated using (exists (select 1 from public.saas_memberships m where m.organization_id = id and m.auth_user_id = auth.uid() and m.status = 'active'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy acervo_authenticated_read on public.acervo_exercicios for select to authenticated using (true);
exception when duplicate_object then null; end $$;

grant usage on schema public to authenticated, service_role;

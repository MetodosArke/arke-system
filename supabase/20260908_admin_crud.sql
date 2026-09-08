-- Arke: persistência administrativa e convites
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  username text not null unique,
  module text not null check (module in ('academia','studio','profissional','aluno','administrador')),
  role text not null,
  status text not null default 'Ativo' check (status in ('Ativo','Suspenso')),
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
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  username text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '72 hours')
);

create table if not exists public.app_password_resets (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.app_users enable row level security;
alter table public.app_students enable row level security;
alter table public.app_invitations enable row level security;
alter table public.app_password_resets enable row level security;

-- O backend usa a service role; não exponha essa chave no navegador.
-- Para uso direto com Supabase Auth, crie políticas adicionais baseadas em auth.uid().

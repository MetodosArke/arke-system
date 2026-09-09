-- Arke: dados completos do cadastro operacional do cliente
alter table if exists public.app_users
  add column if not exists profile_data jsonb not null default '{}'::jsonb;

comment on column public.app_users.profile_data is 'Campos complementares do cadastro: documento, plano, endereço, telefone e dados de acesso.';

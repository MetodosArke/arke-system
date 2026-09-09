-- Arke: logos individuais por cliente/usuário operacional
alter table if exists public.app_users
  add column if not exists "logoUrl" text;

comment on column public.app_users."logoUrl" is 'Data URL ou referência pública da logo vinculada ao workspace do cliente';

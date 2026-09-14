-- Arke: Fase 2/3 do plano de migração — funções RPC que substituem as
-- transações Drizzle (`db.transaction`) de server/db.ts. server/db.ts
-- passa a falar com Supabase via REST com service_role (mesmo padrão de
-- server/supabaseAdmin.ts), mas duas operações precisam continuar
-- atômicas mesmo assim: criar uma organização completa (organização +
-- unidade + membership do owner + assinatura + onboarding + matriz de
-- module_policies) e aceitar um convite (validar + criar membership +
-- marcar convite como aceito). Uma função Postgres roda inteira numa
-- única transação, então resolve isso sem precisar de transação
-- explícita do lado do Node.
--
-- Também preenche uma lacuna encontrada na Fase 0: o mirror saas_* criado
-- em 20260912_portal_unified.sql nunca incluiu uma tabela para
-- drizzle/schema.ts -> invitations. saas_invitations é adicionada aqui,
-- já com RLS.

create table if not exists public.saas_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id),
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'manager', 'professional', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_saas_invitations_org on public.saas_invitations(organization_id);

alter table public.saas_invitations enable row level security;

-- public.saas_is_org_admin e public.saas_super_admin_has_access já existem
-- (20260914_core_rls_policies.sql e 20260914_super_admin_full_service_access.sql,
-- aplicados antes deste arquivo).

drop policy if exists saas_invitations_admin_read on public.saas_invitations;
create policy saas_invitations_admin_read
  on public.saas_invitations for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_invitations_admin_write on public.saas_invitations;
create policy saas_invitations_admin_write
  on public.saas_invitations for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

create or replace function public.create_organization_with_owner(
  p_user_id uuid,
  p_client_id uuid,
  p_name text,
  p_slug text,
  p_plan text,
  p_module text default 'academia',
  p_logo_url text default null,
  p_primary_color text default null
)
returns table (organization_id uuid, unit_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_unit_id uuid;
  v_existing_id uuid;
  v_max_units integer;
  v_max_users integer;
  v_amount_cents integer;
begin
  select id into v_existing_id
  from public.saas_organizations
  where client_id = p_client_id and status in ('active', 'trial')
  limit 1;

  if v_existing_id is not null then
    raise exception 'O cliente já possui uma licença ativa ou em trial' using errcode = '23505';
  end if;

  select l.max_units, l.max_users into v_max_units, v_max_users
  from (values
    ('starter', 1, 12), ('growth', 3, 32), ('scale', 10, 100), ('unlimited', 999, 99999),
    ('essencial', 1, 3), ('performance', 1, 8), ('premium', 1, 20)
  ) as l(plan, max_units, max_users)
  where l.plan = p_plan;

  if v_max_units is null then
    raise exception 'Plano inválido: %', p_plan;
  end if;

  v_amount_cents := case p_plan
    when 'starter' then 39900 when 'growth' then 79900 when 'scale' then 149000
    when 'unlimited' then 349000 when 'essencial' then 14900 when 'performance' then 24900
    when 'premium' then 19900 else 0
  end;

  insert into public.saas_organizations (client_id, name, slug, module, plan, status, logo_url, primary_color, max_units, max_users)
  values (p_client_id, p_name, p_slug, p_module, p_plan, 'trial', p_logo_url, p_primary_color, v_max_units, v_max_users)
  returning id into v_org_id;

  insert into public.saas_units (organization_id, name, slug, status)
  values (v_org_id, p_name, 'sede-principal', 'active')
  returning id into v_unit_id;

  insert into public.saas_memberships (organization_id, auth_user_id, role, status)
  values (v_org_id, p_user_id, 'owner', 'active');

  insert into public.saas_subscriptions (organization_id, plan, status, billing_cycle, amount_cents, provider)
  values (v_org_id, p_plan, 'trialing', 'monthly', v_amount_cents, 'sandbox');

  insert into public.saas_onboarding (organization_id, current_step, status, default_unit_name)
  values (v_org_id, 1, 'in_progress', p_name);

  insert into public.saas_module_policies (organization_id, unit_id, role, module, can_view, can_manage)
  select
    v_org_id, v_unit_id, r.role, m.module,
    true,
    (r.role in ('owner', 'admin') or (r.role = 'manager' and m.module in ('dashboard', 'academias', 'profissionais', 'alunos', 'agenda')))
  from unnest(array['owner', 'admin', 'manager', 'professional', 'viewer']) as r(role)
  cross join unnest(array['dashboard', 'academias', 'profissionais', 'alunos', 'agenda', 'financeiro', 'integracoes']) as m(module);

  return query select v_org_id, v_unit_id;
end;
$$;

create or replace function public.accept_organization_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns table (organization_id uuid, role text, invitation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
begin
  select * into v_invitation
  from public.saas_invitations
  where token_hash = p_token_hash and status = 'pending'
  limit 1;

  if v_invitation.id is null then
    raise exception 'Invitation not found or already used';
  end if;

  if v_invitation.expires_at < now() then
    update public.saas_invitations set status = 'expired' where id = v_invitation.id;
    raise exception 'Invitation expired';
  end if;

  if lower(v_invitation.email) <> lower(p_email) then
    raise exception 'Invitation email does not match the authenticated user';
  end if;

  insert into public.saas_memberships (organization_id, auth_user_id, role, status)
  values (v_invitation.organization_id, p_user_id, v_invitation.role, 'active')
  on conflict (organization_id, auth_user_id) do update set role = excluded.role, status = 'active';

  update public.saas_invitations set status = 'accepted' where id = v_invitation.id;

  return query select v_invitation.organization_id, v_invitation.role, v_invitation.id;
end;
$$;

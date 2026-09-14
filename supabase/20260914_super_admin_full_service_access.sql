-- Arke: adendo à Fase 1 — acesso de super_admin condicionado ao "serviço
-- completo" contratado pela academia.
--
-- Regra de negócio (definida pelo cliente): por padrão, o super_admin
-- (Administrador Arke) NÃO tem acesso automático aos dados de uma
-- organização — só quando ela contrata o serviço completo Arke
-- (full_service_enabled = true). Isso é a aplicação literal da regra já
-- prevista no CLAUDE.md (seção 2, papel "Administrador Arke"): "Acesso a
-- dados individuais só quando necessário/autorizado".
--
-- Este arquivo substitui o bypass incondicional de super_admin criado em
-- 20260914_core_rls_policies.sql. Nada quebra hoje: o backend continua
-- operando com service_role (que sempre ignora RLS), então isto só afeta
-- acesso direto via sessão autenticada de um super_admin.

-- ---------------------------------------------------------------------
-- 1. Flag comercial na organização
-- ---------------------------------------------------------------------
alter table public.saas_organizations
  add column if not exists full_service_enabled boolean not null default false;

comment on column public.saas_organizations.full_service_enabled is
  'Quando true, a academia contratou o serviço completo Arke: super_admin (Administrador Arke) passa a ter acesso a todos os dados desta organização. Quando false (padrão), super_admin não tem bypass automático — só o backend com service_role.';

-- ---------------------------------------------------------------------
-- 2. super_admin só "conta" para uma organização específica se ela
--    tiver optado pelo serviço completo
-- ---------------------------------------------------------------------
create or replace function public.saas_super_admin_has_access(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'super_admin')
    and exists (
      select 1 from public.saas_organizations o
      where o.id = _org_id and o.full_service_enabled
    )
$$;

-- ---------------------------------------------------------------------
-- 3. Troca, em cada tabela saas_*, o bypass incondicional de super_admin
--    pelo bypass condicionado ao serviço completo
-- ---------------------------------------------------------------------

-- saas_organizations
drop policy if exists saas_organizations_member_read on public.saas_organizations;
create policy saas_organizations_member_read
  on public.saas_organizations for select to authenticated
  using (public.saas_is_org_member(id) or public.saas_super_admin_has_access(id));

drop policy if exists saas_organizations_admin_update on public.saas_organizations;
create policy saas_organizations_admin_update
  on public.saas_organizations for update to authenticated
  using (public.saas_is_org_admin(id) or public.saas_super_admin_has_access(id))
  with check (public.saas_is_org_admin(id) or public.saas_super_admin_has_access(id));

-- saas_units
drop policy if exists saas_units_member_read on public.saas_units;
create policy saas_units_member_read
  on public.saas_units for select to authenticated
  using (public.saas_is_org_member(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_units_admin_write on public.saas_units;
create policy saas_units_admin_write
  on public.saas_units for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_units_admin_update on public.saas_units;
create policy saas_units_admin_update
  on public.saas_units for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

-- saas_memberships
drop policy if exists saas_memberships_visible on public.saas_memberships;
create policy saas_memberships_visible
  on public.saas_memberships for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.saas_is_org_admin(organization_id)
    or public.saas_org_role(organization_id) = 'manager'
    or public.saas_super_admin_has_access(organization_id)
  );

drop policy if exists saas_memberships_admin_write on public.saas_memberships;
create policy saas_memberships_admin_write
  on public.saas_memberships for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_memberships_admin_update on public.saas_memberships;
create policy saas_memberships_admin_update
  on public.saas_memberships for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_memberships_admin_delete on public.saas_memberships;
create policy saas_memberships_admin_delete
  on public.saas_memberships for delete to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

-- saas_subscriptions
drop policy if exists saas_subscriptions_admin_read on public.saas_subscriptions;
create policy saas_subscriptions_admin_read
  on public.saas_subscriptions for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

-- saas_module_policies
drop policy if exists saas_module_policies_member_read on public.saas_module_policies;
create policy saas_module_policies_member_read
  on public.saas_module_policies for select to authenticated
  using (public.saas_is_org_member(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_module_policies_admin_write on public.saas_module_policies;
create policy saas_module_policies_admin_write
  on public.saas_module_policies for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_module_policies_admin_update on public.saas_module_policies;
create policy saas_module_policies_admin_update
  on public.saas_module_policies for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_module_policies_admin_delete on public.saas_module_policies;
create policy saas_module_policies_admin_delete
  on public.saas_module_policies for delete to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

-- saas_onboarding
drop policy if exists saas_onboarding_admin_read on public.saas_onboarding;
create policy saas_onboarding_admin_read
  on public.saas_onboarding for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

drop policy if exists saas_onboarding_admin_update on public.saas_onboarding;
create policy saas_onboarding_admin_update
  on public.saas_onboarding for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

-- saas_audit_logs
drop policy if exists saas_audit_logs_admin_read on public.saas_audit_logs;
create policy saas_audit_logs_admin_read
  on public.saas_audit_logs for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

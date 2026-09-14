-- Arke: Fase 1 do plano de migração do núcleo SaaS — políticas RLS reais
-- por organização nas tabelas saas_* (schema-alvo corrigido em
-- 20260914_core_schema_target.sql).
--
-- Regra não negociável do CLAUDE.md (seção 2): isolamento entre academias
-- verificado no servidor via RLS, nunca só escondendo botão na interface.
-- Este arquivo é o que torna essa regra real para o núcleo SaaS.
--
-- Pré-requisitos (nesta ordem): Arke-Supabase-Setup.sql (define
-- public.has_role/app_role, usado aqui para o papel "Administrador Arke"),
-- depois 20260912_portal_unified.sql, depois 20260914_core_schema_target.sql.
--
-- Fora do escopo: troca de server/db.ts para usar estas tabelas (Fase 2/3)
-- e RLS das tabelas do piloto arke-app/acervo/asaas, que já têm suas
-- próprias políticas específicas.

-- ---------------------------------------------------------------------
-- 1. Funções auxiliares (security definer, mesmo padrão de public.has_role
--    já usado no piloto, para evitar recursão de RLS ao consultar
--    saas_memberships dentro das próprias políticas de saas_memberships)
-- ---------------------------------------------------------------------
create or replace function public.saas_is_org_member(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.saas_memberships m
    where m.organization_id = _org_id
      and m.auth_user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function public.saas_org_role(_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.saas_memberships m
  where m.organization_id = _org_id
    and m.auth_user_id = auth.uid()
    and m.status = 'active'
  limit 1
$$;

-- "admin da organização" = owner ou admin dentro dela (não confundir com o
-- papel global "Administrador Arke", que é public.has_role(..., 'super_admin'))
create or replace function public.saas_is_org_admin(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.saas_org_role(_org_id) in ('owner', 'admin')
$$;

-- ---------------------------------------------------------------------
-- 2. saas_organizations
-- ---------------------------------------------------------------------
drop policy if exists saas_org_member_read on public.saas_organizations;
drop policy if exists saas_organizations_member_read on public.saas_organizations;
create policy saas_organizations_member_read
  on public.saas_organizations for select to authenticated
  using (public.saas_is_org_member(id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_organizations_admin_update on public.saas_organizations;
create policy saas_organizations_admin_update
  on public.saas_organizations for update to authenticated
  using (public.saas_is_org_admin(id) or public.has_role(auth.uid(), 'super_admin'))
  with check (public.saas_is_org_admin(id) or public.has_role(auth.uid(), 'super_admin'));

-- Sem policy de insert/delete para "authenticated": criação e remoção de
-- organização continuam exclusivas do backend (service role), porque
-- createOrganizationWithOwner precisa criar organização+unidade+membership+
-- subscription+policies como uma transação atômica.

-- ---------------------------------------------------------------------
-- 3. saas_units
-- ---------------------------------------------------------------------
drop policy if exists saas_units_member_read on public.saas_units;
create policy saas_units_member_read
  on public.saas_units for select to authenticated
  using (public.saas_is_org_member(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_units_admin_write on public.saas_units;
create policy saas_units_admin_write
  on public.saas_units for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_units_admin_update on public.saas_units;
create policy saas_units_admin_update
  on public.saas_units for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'))
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

-- Sem delete: unidades são arquivadas (status='archived'), nunca apagadas.

-- ---------------------------------------------------------------------
-- 4. saas_memberships
-- ---------------------------------------------------------------------
drop policy if exists saas_membership_self_read on public.saas_memberships;
drop policy if exists saas_memberships_visible on public.saas_memberships;
create policy saas_memberships_visible
  on public.saas_memberships for select to authenticated
  using (
    auth_user_id = auth.uid()
    or public.saas_is_org_admin(organization_id)
    or public.saas_org_role(organization_id) = 'manager'
    or public.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists saas_memberships_admin_write on public.saas_memberships;
create policy saas_memberships_admin_write
  on public.saas_memberships for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_memberships_admin_update on public.saas_memberships;
create policy saas_memberships_admin_update
  on public.saas_memberships for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'))
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_memberships_admin_delete on public.saas_memberships;
create policy saas_memberships_admin_delete
  on public.saas_memberships for delete to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 5. saas_subscriptions — dado financeiro: só admin da organização lê,
--    e só o backend (service role, via webhook Asaas) escreve.
-- ---------------------------------------------------------------------
drop policy if exists saas_subscriptions_admin_read on public.saas_subscriptions;
create policy saas_subscriptions_admin_read
  on public.saas_subscriptions for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 6. saas_module_policies — qualquer membro precisa ler (para saber o que
--    pode acessar); só admin da organização escreve.
-- ---------------------------------------------------------------------
drop policy if exists saas_module_policies_member_read on public.saas_module_policies;
create policy saas_module_policies_member_read
  on public.saas_module_policies for select to authenticated
  using (public.saas_is_org_member(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_module_policies_admin_write on public.saas_module_policies;
create policy saas_module_policies_admin_write
  on public.saas_module_policies for insert to authenticated
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_module_policies_admin_update on public.saas_module_policies;
create policy saas_module_policies_admin_update
  on public.saas_module_policies for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'))
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_module_policies_admin_delete on public.saas_module_policies;
create policy saas_module_policies_admin_delete
  on public.saas_module_policies for delete to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 7. saas_onboarding — só admin da organização; criação continua com o
--    backend, junto da criação da organização.
-- ---------------------------------------------------------------------
drop policy if exists saas_onboarding_admin_read on public.saas_onboarding;
create policy saas_onboarding_admin_read
  on public.saas_onboarding for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

drop policy if exists saas_onboarding_admin_update on public.saas_onboarding;
create policy saas_onboarding_admin_update
  on public.saas_onboarding for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'))
  with check (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------
-- 8. saas_audit_logs — trilha de auditoria: só admin da organização lê;
--    só o backend escreve (recordAuditLog roda com credenciais de servidor).
-- ---------------------------------------------------------------------
drop policy if exists saas_audit_logs_admin_read on public.saas_audit_logs;
create policy saas_audit_logs_admin_read
  on public.saas_audit_logs for select to authenticated
  using (public.saas_is_org_admin(organization_id) or public.has_role(auth.uid(), 'super_admin'));

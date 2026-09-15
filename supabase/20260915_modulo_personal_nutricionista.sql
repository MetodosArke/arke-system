-- Arke: Fase 11 do roadmap (CLAUDE.md §9) — Módulos Personal/Nutricionista.
--
-- A infraestrutura genérica de organização/convite/prescrição já existia e
-- funcionava para o módulo "profissional" (criação de organização, convite
-- de aluno, treino/dieta, ficha em PDF). Esta migração fecha duas lacunas
-- reais encontradas ao investigar o código:
--
-- 1. Não existia o papel de equipe "nutricionista", distinto de
--    "professional" — o que contraria a tabela de RBAC do CLAUDE.md §2:
--    "Profissional de treino" não publica plano alimentar, "Nutricionista"
--    não publica prescrição de treino. Hoje o papel "professional" podia
--    fazer as duas coisas sem distinção.
-- 2. O endpoint de convite de equipe (saas_invitations /
--    accept_organization_invitation) só aceitava roles sem "nutricionista".
--
-- Escopo: apenas liberar "nutricionista" como valor válido de role nas
-- tabelas que já modelam papéis de equipe, e semear a matriz de
-- module_policies para esse papel do mesmo jeito que os demais. A
-- separação de permissão (nutricionista não publica treino, professional
-- não publica plano alimentar) é aplicada em código (server/routers.ts),
-- não em RLS — mesmo padrão já usado para STAFF_ROLES/MANAGER_ROLES.

alter table public.saas_memberships drop constraint if exists saas_memberships_role_check;
alter table public.saas_memberships add constraint saas_memberships_role_check
  check (role in ('owner', 'admin', 'manager', 'professional', 'nutricionista', 'viewer'));

alter table public.saas_module_policies drop constraint if exists saas_module_policies_role_check;
alter table public.saas_module_policies add constraint saas_module_policies_role_check
  check (role in ('owner', 'admin', 'manager', 'professional', 'nutricionista', 'viewer'));

alter table public.saas_invitations drop constraint if exists saas_invitations_role_check;
alter table public.saas_invitations add constraint saas_invitations_role_check
  check (role in ('admin', 'manager', 'professional', 'nutricionista', 'viewer'));

-- create_organization_with_owner (20260914_organization_rpcs.sql) semeia
-- saas_module_policies para todos os papéis de equipe no momento da
-- criação da organização — inclui "nutricionista" na mesma matriz, sem
-- alterar o restante da função.
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
  from unnest(array['owner', 'admin', 'manager', 'professional', 'nutricionista', 'viewer']) as r(role)
  cross join unnest(array['dashboard', 'academias', 'profissionais', 'alunos', 'agenda', 'financeiro', 'integracoes']) as m(module);

  return query select v_org_id, v_unit_id;
end;
$$;

-- Bug pré-existente descoberto ao validar o convite de equipe desta fase:
-- accept_organization_invitation nunca funcionou de fato. O parâmetro de
-- saída "organization_id" (de "returns table (organization_id uuid, ...")
-- colide com a coluna de mesmo nome referenciada em
-- "on conflict (organization_id, auth_user_id)" dentro do corpo da função
-- — o plpgsql tenta resolver o identificador como a variável de saída,
-- gerando "column reference organization_id is ambiguous" (42702) em toda
-- chamada real. Renomeia apenas o parâmetro de saída em conflito
-- (organization_id -> org_id); server/db.ts é ajustado para ler o campo
-- renomeado no retorno da RPC.
drop function if exists public.accept_organization_invitation(text, uuid, text);

create function public.accept_organization_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns table (org_id uuid, role text, invitation_id uuid)
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

-- 20260914_lock_down_rpc_execute_grants.sql restringe esta RPC a
-- service_role; a função foi recriada (drop+create), então os grants
-- padrão do Postgres (que incluiriam PUBLIC) precisam ser refeitos aqui.
revoke execute on function public.accept_organization_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_organization_invitation(text, uuid, text) to service_role;

-- saas_invitations tinha apenas policies de select/insert (admin/owner da
-- organização); a Fase 11 adiciona uma tela para revogar convite de
-- equipe pendente (UPDATE status='revoked'), então a policy de UPDATE
-- precisa existir também — mesmo padrão de saas_is_org_admin já usado nas
-- outras duas policies desta tabela. Defesa em profundidade: o caminho
-- real do app usa service_role (bypassa RLS), mas a policy documenta e
-- garante a regra no banco também.
drop policy if exists saas_invitations_admin_update on public.saas_invitations;
create policy saas_invitations_admin_update
  on public.saas_invitations for update to authenticated
  using (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id))
  with check (public.saas_is_org_admin(organization_id) or public.saas_super_admin_has_access(organization_id));

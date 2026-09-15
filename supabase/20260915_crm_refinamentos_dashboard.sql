-- Refinamento do CRM de vendas (supabase/20260915_crm_vendas_funil_leads.sql),
-- a partir de spec aprovada pelo usuário. Cinco pontos:
--
-- 1. Campos novos em leads: unit_id (segmentar por unidade em academias
--    multi-unidade) e interesse (o que motivou o contato — hoje só existia
--    dentro do texto livre de "notas").
-- 2. Funil/etapas: mantido enum fixo (opção mínima aprovada), mas com um
--    novo estágio 'convite_enviado' entre "visita_agendada" e "matriculado"
--    — ver ponto 4.
-- 3. RBAC: CRM de vendas é operação comercial. O CLAUDE.md (§2) não dá a
--    "Profissional de treino" nem a "Nutricionista" nenhum acesso comercial
--    — só a "membros atribuídos, avaliações, treinos" / "atendimento
--    nutricional". A RLS de leads/lead_atividades usava
--    saas_is_org_staff (que inclui professional/nutricionista); passa a
--    usar a nova saas_is_org_manager (owner/admin/manager), no mesmo nível
--    já usado no server por MANAGER_ROLES.
-- 4. Conversão lead→membro em duas etapas: converterLead marcava
--    "matriculado" no momento em que o convite era ENVIADO, não quando era
--    ACEITO — inflava a métrica de conversão com convites nunca abertos.
--    Agora converterLead move para 'convite_enviado'; accept_member_invitation
--    (aceite real, em server/supabaseAdmin.ts) marca 'matriculado' e
--    convertido_em quando o convite vinculado é de fato aceito.
-- 5. Indicadores: sem tabela nova — getCrmIndicadores (server/supabaseAdmin.ts)
--    agrega os dados já existentes (leads, lead_atividades).

alter table public.leads add column if not exists unit_id uuid references public.saas_units(id) on delete set null;
alter table public.leads add column if not exists interesse text;

create index if not exists leads_org_unit_idx on public.leads (organization_id, unit_id);

alter table public.leads drop constraint if exists leads_estagio_check;
alter table public.leads add constraint leads_estagio_check
  check (estagio in ('novo', 'contato_feito', 'visita_agendada', 'convite_enviado', 'matriculado', 'perdido'));

-- "manager da organização" = owner, admin ou manager — o mesmo corte que
-- MANAGER_ROLES já usa no server (server/routers.ts) para Gestão. Fica
-- separado de saas_is_org_admin (só owner/admin) porque manager já tem
-- acesso de equipe/operação hoje (CLAUDE.md §2), CRM de vendas incluído.
create or replace function public.saas_is_org_manager(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.saas_org_role(_org_id) in ('owner', 'admin', 'manager')
$$;

drop policy if exists "Staff manages leads da própria organização" on public.leads;
create policy "Manager gerencia leads da própria organização"
  on public.leads
  for all
  using (public.saas_is_org_manager(organization_id))
  with check (public.saas_is_org_manager(organization_id));

drop policy if exists "Staff manages lead_atividades da própria organização" on public.lead_atividades;
create policy "Manager gerencia lead_atividades da própria organização"
  on public.lead_atividades
  for all
  using (public.saas_is_org_manager(organization_id))
  with check (public.saas_is_org_manager(organization_id));

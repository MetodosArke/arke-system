-- Arke: Fase 0 do plano de migração do núcleo SaaS (Drizzle/TiDB) para Supabase.
--
-- Objetivo desta migração: corrigir o schema saas_* já existente (criado em
-- 20260912_portal_unified.sql, mas nunca consumido pelo código) para que ele
-- vire o schema-alvo único do núcleo SaaS, e começar a unificar o conceito
-- de tenant hoje duplicado entre "organizations" (núcleo SaaS) e "academias"
-- (piloto arke-app).
--
-- Escopo desta etapa (aditivo/idempotente, seguro para aplicar mesmo com
-- dados já existentes):
--   1. saas_organizations ganha paridade de colunas com drizzle/schema.ts
--   2. saas_memberships / saas_module_policies / saas_onboarding ganham
--      as mesmas restrições (CHECK) que hoje só existem como enum no Drizzle
--   3. profiles e treinos (piloto) ganham organization_id apontando para
--      saas_organizations, em paralelo ao academia_id existente
--   4. remoção das tabelas de acervo global que foram criadas mas nunca
--      chegaram a ser lidas/escritas por nenhum código (acervo_exercicios,
--      acervo_grupos_musculares, acervo_modelos_treino) — o acervo real
--      usa exercicios/grupos_musculares/treino_templates
--
-- Fora do escopo desta etapa (fica para a Fase 4 — migração de dados — e
-- Fase 5 — corte, no plano acordado):
--   - backfill de organization_id a partir de academia_id
--   - remoção de academias / academia_id
--   - troca de server/db.ts para consumir estas tabelas
--   - políticas de RLS por organização (Fase 1)
--   - correção da divergência de schema do asaas_payments (Fase 6)
--
-- Executar no SQL Editor do projeto Supabase. Não insere dados de teste.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. saas_organizations: paridade com drizzle/schema.ts -> organizations
-- ---------------------------------------------------------------------
alter table public.saas_organizations
  add column if not exists max_units integer not null default 1,
  add column if not exists max_users integer not null default 12,
  add column if not exists reconciliation_status text not null default 'review',
  add column if not exists reconciliation_note text;

do $$ begin
  alter table public.saas_organizations
    add constraint saas_organizations_plan_check
    check (plan in ('starter','growth','scale','unlimited','essencial','performance','premium'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.saas_organizations
    add constraint saas_organizations_status_check
    check (status in ('trial','active','past_due','canceled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.saas_organizations
    add constraint saas_organizations_reconciliation_check
    check (reconciliation_status in ('matched','review'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. saas_memberships / saas_module_policies / saas_onboarding: travar
--    valores hoje em texto livre para bater com os enums do Drizzle
-- ---------------------------------------------------------------------
do $$ begin
  alter table public.saas_memberships
    add constraint saas_memberships_role_check
    check (role in ('owner','admin','manager','professional','viewer'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.saas_memberships
    add constraint saas_memberships_status_check
    check (status in ('active','invited','suspended'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.saas_module_policies
    add constraint saas_module_policies_role_check
    check (role in ('owner','admin','manager','professional','viewer'));
exception when duplicate_object then null; end $$;

alter table public.saas_onboarding
  add column if not exists default_unit_name text;

do $$ begin
  alter table public.saas_onboarding
    add constraint saas_onboarding_status_check
    check (status in ('not_started','in_progress','completed'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Unificação de tenant (etapa 1 de 2): organization_id em paralelo
--    a academia_id. academias e academia_id continuam funcionando sem
--    interrupção até o backfill da Fase 4.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists organization_id uuid references public.saas_organizations(id) on delete set null;

alter table public.treinos
  add column if not exists organization_id uuid references public.saas_organizations(id) on delete set null;

create index if not exists idx_profiles_organization on public.profiles(organization_id);
create index if not exists idx_treinos_organization on public.treinos(organization_id);

comment on column public.profiles.academia_id is 'DEPRECATED: substituído por organization_id (saas_organizations). Remover após backfill na Fase 4 do plano de migração.';
comment on column public.treinos.academia_id is 'DEPRECATED: substituído por organization_id (saas_organizations). Remover após backfill na Fase 4 do plano de migração.';
comment on table public.academias is 'DEPRECATED: absorvida por saas_organizations. Mantida apenas até o backfill (Fase 4) para não interromper o piloto arke-app em produção.';

-- ---------------------------------------------------------------------
-- 4. Acervo global: remove as tabelas que nunca foram usadas por
--    nenhum código (server/supabaseAdmin.ts lê exercicios/
--    grupos_musculares/treino_templates, nunca estas). Seguro remover:
--    sem leitura nem escrita conhecida, sem risco de perda de dado usado.
-- ---------------------------------------------------------------------
drop table if exists public.acervo_modelos_treino;
drop table if exists public.acervo_grupos_musculares;
drop table if exists public.acervo_exercicios;

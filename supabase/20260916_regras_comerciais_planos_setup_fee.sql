-- Regras comerciais: novos valores de plano (Academia/Studio Starter 299/
-- Growth 699/Scale 1490; Profissional Essencial 79/Performance 149/
-- Ilimitado 249 — substitui "unlimited" e "premium"). Sem dado real hoje
-- (0 organizações), então a troca do check constraint é direta.
alter table public.saas_organizations drop constraint saas_organizations_plan_check;
alter table public.saas_organizations add constraint saas_organizations_plan_check
  check (plan = any (array['starter','growth','scale','essencial','performance','ilimitado']));

alter table public.saas_organizations add column setup_fee_charged_at timestamptz;

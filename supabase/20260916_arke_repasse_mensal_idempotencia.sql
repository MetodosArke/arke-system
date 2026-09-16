-- Repasse mensal do módulo Arke (nº de alunos ativos x R$59,90, cobrado
-- da academia): idempotência por organização/mês.
alter table public.saas_arke_module add column last_repasse_charged_at date;

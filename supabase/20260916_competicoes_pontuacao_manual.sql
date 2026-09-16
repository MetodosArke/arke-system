-- Fase 2 (engajamento) — Competições: mesma decisão de escopo dos
-- Desafios (20260916_modulo_arke_fase0_multitenant.sql já deu
-- organization_id/RLS a competicoes/competicao_participantes). O app
-- original rankeava competições a partir do motor de pontuação
-- automático (usePontuacaoMensal / registro_treino / dieta_adesao), que
-- ainda não existe no SaaS novo. Esta tabela nova guarda um valor por
-- aluno digitado manualmente pela equipe — nunca calculado — para não
-- fingir uma análise que o sistema não fez (CLAUDE.md).

create table public.competicao_pontuacao (
  id uuid primary key default gen_random_uuid(),
  competicao_id uuid not null references public.competicoes(id) on delete cascade,
  aluno_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  valor numeric not null default 0,
  atualizado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competicao_id, aluno_id)
);

alter table public.competicao_pontuacao enable row level security;
create index idx_competicao_pontuacao_org on public.competicao_pontuacao(organization_id);
create index idx_competicao_pontuacao_competicao on public.competicao_pontuacao(competicao_id);

-- Ranking é público entre membros da mesma organização (mesmo padrão do
-- app original, que mostrava a lista inteira, não só a linha do aluno).
create policy "arke staff gerencia competicao_pontuacao da org" on public.competicao_pontuacao for all using (saas_is_org_staff(organization_id)) with check (saas_is_org_staff(organization_id));
create policy "arke membros leem competicao_pontuacao da org" on public.competicao_pontuacao for select using (saas_is_org_member(organization_id));

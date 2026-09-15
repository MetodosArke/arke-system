-- Fase 9 (Módulo Academia): matrícula, frequência e fichas em PDF.
-- CLAUDE.md seção 9, item 9. A ficha (treinos/treino_exercicios) e sua
-- versão em PDF já usam dados existentes — não precisam de tabela nova.

-- Matrícula: formaliza o vínculo aluno-unidade que já existia de forma
-- implícita (só organização, sem unidade específica) desde a Fase 5.
alter table public.profiles
  add column if not exists unit_id uuid references public.saas_units(id) on delete set null,
  add column if not exists matricula_em timestamptz;

-- Faltava uma política de UPDATE para staff em profiles (só existia
-- para admin/super_admin e para o próprio usuário) — necessária para
-- que o profissional/gestor edite unidade e data de matrícula do
-- aluno. O trigger de organization_id (Fase 3) já impede que essa
-- política seja usada para trocar a organização do aluno.
create policy "Staff atualiza profiles da própria organização"
  on public.profiles for update
  using (organization_id is not null and saas_is_org_staff(organization_id))
  with check (organization_id is not null and saas_is_org_staff(organization_id));

-- Frequência: registro de presença física na academia. A integração
-- real por marca de catraca continua bloqueada (CLAUDE.md §8.4/roadmap
-- item 15 — sem academia piloto definida ainda), então o mesmo
-- registro serve tanto para quando essa integração existir (origem
-- 'catraca') quanto para registro manual da recepção/profissional
-- (origem 'manual') enquanto isso.
create table public.frequencia_registros (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  unit_id uuid references public.saas_units(id) on delete set null,
  origem text not null check (origem in ('catraca', 'manual')),
  registrado_por uuid references auth.users(id) on delete set null,
  registrado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index frequencia_registros_org_idx on public.frequencia_registros (organization_id, registrado_em desc);
create index frequencia_registros_aluno_idx on public.frequencia_registros (aluno_id, registrado_em desc);

alter table public.frequencia_registros enable row level security;

create policy "Staff manages frequência da própria organização"
  on public.frequencia_registros
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

create policy "Aluno lê própria frequência"
  on public.frequencia_registros for select
  using (auth.uid() = aluno_id);

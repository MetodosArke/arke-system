-- =====================================================================
-- ARKE — FASE 2: Onboarding M.A.P.A.® + Anamnese de Acolhimento
-- =====================================================================

create type public.provedor_treino as enum ('academia_propria', 'personal_parceiro', 'equipe_arke');
create type public.provedor_nutricao as enum ('nenhum', 'nutricionista_academia', 'equipe_arke');
create type public.fase_jornada as enum ('mapa', 'base', 'rota', 'apex', 'legado');
create type public.motivo_dificuldade as enum ('tempo', 'execucao', 'alimentacao', 'desconforto_dor', 'motivacao');

-- Entidades exigidas pela Metodologia ARKE (seção 4 do mapeamento)
alter table public.alunos
  add column provedor_treino public.provedor_treino not null default 'academia_propria',
  add column provedor_nutricao public.provedor_nutricao not null default 'nenhum',
  add column fase_jornada public.fase_jornada not null default 'mapa',
  add column primeiro_acesso_em timestamptz;

-- Motivo da dificuldade relatada no check-in R.O.T.A.® (Fase 3, sustentar)
alter table public.checkins
  add column motivo_dificuldade public.motivo_dificuldade;

-- Anamnese de Acolhimento (M.A.P.A.® — Descobrir, dias 0 a 2)
create table public.anamnese_acolhimento (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  aluno_id               uuid not null references public.alunos(id) on delete cascade,
  rotina_diaria          text,
  objetivo_principal     text,
  experiencias_exercicio text,
  dores_lesoes           text,
  medicamentos           text,
  tempo_disponivel       text,
  estilo_treino          text,
  alimentos_gosta        text,
  alimentos_nao_gosta    text,
  alimentacao_rotina     text,
  expectativas           text,
  concluida_em           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (aluno_id)
);

create index idx_anamnese_org on public.anamnese_acolhimento(organization_id);

create trigger trg_anamnese_updated_at
  before update on public.anamnese_acolhimento
  for each row execute function public.set_updated_at();

alter table public.anamnese_acolhimento enable row level security;

create policy "aluno gerencia a própria anamnese"
  on public.anamnese_acolhimento for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê/gerencia anamnese dos seus alunos"
  on public.anamnese_acolhimento for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- =====================================================================
-- Automação M.A.P.A.®: "Aluno sem 1º acesso após 48h" → Tarefa de Ativação
-- =====================================================================

create extension if not exists pg_cron;

create or replace function public.gerar_tarefas_ativacao_pendente()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento)
  select
    a.organization_id,
    a.id,
    'Aluno sem 1º acesso após 48h',
    'alta',
    now() + interval '24 hours',
    'ativacao_pendente:' || a.id::text
  from public.alunos a
  where a.primeiro_acesso_em is null
    and a.created_at < now() - interval '48 hours'
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

select cron.schedule(
  'arke-ativacao-pendente',
  '0 * * * *',
  $$select public.gerar_tarefas_ativacao_pendente();$$
);

revoke execute on function public.gerar_tarefas_ativacao_pendente() from anon, authenticated;

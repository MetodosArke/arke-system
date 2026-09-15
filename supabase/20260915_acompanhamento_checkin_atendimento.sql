-- Fase 6 (Acompanhamento): check-in do aluno + central de atendimento.
-- CLAUDE.md seção 4: módulos "Check-ins" e "Central de atendimento".
-- CLAUDE.md seção 6: prioridade sem falsa precisão (categorias
-- explicáveis: Rotina, Atenção, Prioritário, Encaminhamento profissional)
-- e "nunca duplicar tarefa aberta".
--
-- Escopo desta etapa: check-in simples + fila de atendimento com uma
-- regra fixa (check-in com dificuldade/pedido de ajuda vira tarefa).
-- O motor de regras configurável e o escalonamento automático de
-- prazo vencido ficam para a Fase 7 ("Automação").

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  aluno_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  status text not null check (status in ('indo_bem', 'com_dificuldade', 'quero_ajuda')),
  observacao text,
  created_at timestamptz not null default now()
);

create index check_ins_org_idx on public.check_ins (organization_id, created_at desc);
create index check_ins_aluno_idx on public.check_ins (aluno_id, created_at desc);

alter table public.check_ins enable row level security;

create policy "Aluno registra próprio check-in"
  on public.check_ins for insert
  with check (auth.uid() = aluno_id);

create policy "Aluno lê próprios check-ins"
  on public.check_ins for select
  using (auth.uid() = aluno_id);

create policy "Staff lê check-ins da própria organização"
  on public.check_ins for select
  using (saas_is_org_staff(organization_id));

create table public.atendimentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  aluno_id uuid not null references auth.users(id) on delete cascade,
  origem text not null check (origem in ('check_in', 'pedido_direto', 'manual')),
  origem_check_in_id uuid references public.check_ins(id) on delete set null,
  prioridade text not null check (prioridade in ('rotina', 'atencao', 'prioritario', 'encaminhamento_profissional')),
  descricao text,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'resolvida')),
  responsavel_id uuid references auth.users(id) on delete set null,
  prazo timestamptz,
  resultado text,
  resolvido_por uuid references auth.users(id) on delete set null,
  resolvido_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index atendimentos_org_status_idx on public.atendimentos (organization_id, status);
create index atendimentos_aluno_idx on public.atendimentos (aluno_id, created_at desc);

-- "Nunca duplicar tarefa aberta" (CLAUDE.md §6): no máximo uma tarefa
-- aberta/em andamento por aluno e origem.
create unique index atendimentos_aluno_origem_aberta_idx on public.atendimentos (aluno_id, origem) where status in ('aberta', 'em_andamento');

create trigger update_atendimentos_updated_at
  before update on public.atendimentos
  for each row execute function public.update_updated_at_column();

alter table public.atendimentos enable row level security;

create policy "Staff manages atendimentos da própria organização"
  on public.atendimentos
  for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

create policy "Aluno lê próprios atendimentos"
  on public.atendimentos for select
  using (auth.uid() = aluno_id);

create policy "Aluno cria pedido direto para si mesmo"
  on public.atendimentos for insert
  with check (
    auth.uid() = aluno_id
    and origem = 'pedido_direto'
    and status = 'aberta'
    and responsavel_id is null
    and resultado is null
  );

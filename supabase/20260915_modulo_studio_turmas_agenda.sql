-- Fase 10 (Módulo Studio): turmas, horários fixos, limite de vagas, agenda.
-- CLAUDE.md seção 9, item 10.
--
-- A reserva é feita direto contra (turma, data), sem pré-gerar sessões
-- futuras (isso exigiria um job para ficar estendendo o horizonte).
-- O índice único abaixo impede que o mesmo aluno reserve a mesma
-- sessão duas vezes; o limite de vagas é conferido em código a cada
-- reserva (server/supabaseAdmin.ts).

create table public.turmas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  unit_id uuid references public.saas_units(id) on delete set null,
  nome text not null,
  descricao text,
  professor_id uuid references auth.users(id) on delete set null,
  limite_vagas int not null check (limite_vagas > 0),
  duracao_min int not null default 60 check (duracao_min > 0),
  status text not null default 'ativa' check (status in ('ativa', 'inativa')),
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index turmas_org_idx on public.turmas (organization_id, status);

create trigger update_turmas_updated_at
  before update on public.turmas
  for each row execute function public.update_updated_at_column();

create table public.turma_horarios (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6), -- 0 = domingo ... 6 = sábado
  hora_inicio time not null,
  created_at timestamptz not null default now()
);

create index turma_horarios_turma_idx on public.turma_horarios (turma_id);

create table public.turma_reservas (
  id uuid primary key default gen_random_uuid(),
  turma_id uuid not null references public.turmas(id) on delete cascade,
  aluno_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.saas_organizations(id) on delete cascade,
  data date not null,
  status text not null default 'confirmada' check (status in ('confirmada', 'cancelada')),
  criado_em timestamptz not null default now()
);

create unique index turma_reservas_unica_por_aluno on public.turma_reservas (turma_id, data, aluno_id) where status = 'confirmada';
create index turma_reservas_turma_data_idx on public.turma_reservas (turma_id, data) where status = 'confirmada';
create index turma_reservas_aluno_idx on public.turma_reservas (aluno_id, data desc);

alter table public.turmas enable row level security;
alter table public.turma_horarios enable row level security;
alter table public.turma_reservas enable row level security;

create policy "Staff manages turmas da própria organização"
  on public.turmas for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

create policy "Aluno lê turmas ativas da própria organização"
  on public.turmas for select
  using (
    status = 'ativa'
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.organization_id = turmas.organization_id)
  );

create policy "Staff manages horários da própria organização"
  on public.turma_horarios for all
  using (exists (select 1 from public.turmas t where t.id = turma_horarios.turma_id and saas_is_org_staff(t.organization_id)))
  with check (exists (select 1 from public.turmas t where t.id = turma_horarios.turma_id and saas_is_org_staff(t.organization_id)));

create policy "Aluno lê horários de turmas da própria organização"
  on public.turma_horarios for select
  using (exists (
    select 1 from public.turmas t
    join public.profiles p on p.organization_id = t.organization_id
    where t.id = turma_horarios.turma_id and p.user_id = auth.uid() and t.status = 'ativa'
  ));

create policy "Staff manages reservas da própria organização"
  on public.turma_reservas for all
  using (saas_is_org_staff(organization_id))
  with check (saas_is_org_staff(organization_id));

create policy "Aluno lê próprias reservas"
  on public.turma_reservas for select
  using (auth.uid() = aluno_id);

-- Confere que a organização informada é mesmo a do aluno e que a turma
-- pertence a essa organização e está ativa — sem isso, um aluno
-- poderia reservar vaga numa turma de outra organização só informando
-- o organization_id errado no insert.
create policy "Aluno reserva para si mesmo"
  on public.turma_reservas for insert
  with check (
    auth.uid() = aluno_id
    and status = 'confirmada'
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.organization_id = turma_reservas.organization_id)
    and exists (select 1 from public.turmas t where t.id = turma_reservas.turma_id and t.organization_id = turma_reservas.organization_id and t.status = 'ativa')
  );

create policy "Aluno cancela própria reserva"
  on public.turma_reservas for update
  using (auth.uid() = aluno_id)
  with check (auth.uid() = aluno_id and status = 'cancelada');

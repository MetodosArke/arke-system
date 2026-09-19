-- Portando Desafios e Competições do app original. Diferença importante
-- em relação ao original: lá, "competição não aparece pra quem não foi
-- convidado" era só um filtro no JavaScript — o RLS deixava qualquer
-- aluno LER qualquer desafio/competição pela API. Aqui a regra vira RLS
-- de verdade: aluno só enxerga o que é para_todos=true OU onde está
-- matriculado em *_participantes.
create type public.desafio_tipo as enum (
  'sem_doce', 'sem_alcool', 'consumo_agua', 'numero_treinos', 'modalidades', 'desempenho_dieta', 'livre'
);

create table public.desafios (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo          text not null,
  descricao       text,
  tipo            public.desafio_tipo not null default 'livre',
  meta_valor      numeric,
  data_inicio     date not null,
  data_fim        date not null,
  pontos          integer not null default 10,
  criado_por      uuid references auth.users(id) on delete set null,
  para_todos      boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.desafio_participantes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  desafio_id      uuid not null references public.desafios(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (desafio_id, aluno_id)
);

create table public.desafio_progresso (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  desafio_id      uuid not null references public.desafios(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  concluido       boolean not null default false,
  concluido_por   uuid references auth.users(id) on delete set null,
  concluido_em    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (desafio_id, aluno_id)
);

-- ---------------------------------------------------------------------
-- Competições — versão simplificada de métricas (o original tinha 12,
-- muitas derivadas do motor de pontuação de 200 pontos que não estamos
-- portando por inteiro; aqui usamos só o que o sistema já calcula bem).
-- ---------------------------------------------------------------------
create type public.competicao_metrica as enum (
  'pontos_desafios', 'treinos_concluidos', 'km_total', 'dieta_adesao_media'
);

create table public.competicoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo          text not null,
  descricao       text,
  data_inicio     date not null,
  data_fim        date not null,
  metrica         public.competicao_metrica not null default 'pontos_desafios',
  para_todos      boolean not null default true,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.competicao_participantes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competicao_id   uuid not null references public.competicoes(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (competicao_id, aluno_id)
);

-- ---------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------
create trigger trg_desafios_updated_at before update on public.desafios
  for each row execute function public.set_updated_at();

create trigger trg_desafio_progresso_updated_at before update on public.desafio_progresso
  for each row execute function public.set_updated_at();

create trigger trg_competicoes_updated_at before update on public.competicoes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.desafios enable row level security;
alter table public.desafio_participantes enable row level security;
alter table public.desafio_progresso enable row level security;
alter table public.competicoes enable row level security;
alter table public.competicao_participantes enable row level security;

create policy "staff da org gerencia desafios"
  on public.desafios for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê desafios para todos ou em que foi cadastrado"
  on public.desafios for select to authenticated
  using (
    para_todos
    or exists (
      select 1 from public.desafio_participantes dp
      join public.alunos a on a.id = dp.aluno_id
      where dp.desafio_id = desafios.id and a.user_id = auth.uid()
    )
  );

create policy "staff da org gerencia participantes de desafios"
  on public.desafio_participantes for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê a própria participação em desafios"
  on public.desafio_participantes for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org gerencia progresso de desafios"
  on public.desafio_progresso for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê o próprio progresso em desafios"
  on public.desafio_progresso for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org gerencia competições"
  on public.competicoes for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê competições para todos ou em que foi cadastrado"
  on public.competicoes for select to authenticated
  using (
    para_todos
    or exists (
      select 1 from public.competicao_participantes cp
      join public.alunos a on a.id = cp.aluno_id
      where cp.competicao_id = competicoes.id and a.user_id = auth.uid()
    )
  );

create policy "staff da org gerencia participantes de competições"
  on public.competicao_participantes for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê a própria participação em competições"
  on public.competicao_participantes for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

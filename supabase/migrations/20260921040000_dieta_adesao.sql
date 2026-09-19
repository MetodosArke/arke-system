-- Portando do app original: calendário/controle de adesão à dieta — o
-- aluno registra, dia a dia, quanto seguiu o plano, consumo de doce/álcool,
-- água e saciedade. Equivalente ao treino_calendario, só que pro lado da
-- dieta. Liberado pra qualquer aluno com nutrição no plano (nivel_atacado
-- != essencial); não depende do Método ARKE.
create table public.dieta_adesao (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  aluno_id           uuid not null references public.alunos(id) on delete cascade,
  dieta_id           uuid not null references public.dietas(id) on delete cascade,
  data               date not null,
  adesao_percentual  integer not null default 0 check (adesao_percentual between 0 and 100),
  consumiu_doce      boolean not null default false,
  consumiu_alcool    boolean not null default false,
  agua_ml            integer not null default 0,
  nivel_saciedade    text check (nivel_saciedade in ('sem_fome', 'fome_leve', 'fome_moderada', 'muita_fome')),
  fome_manha         boolean not null default false,
  fome_tarde         boolean not null default false,
  fome_noite         boolean not null default false,
  observacoes        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (aluno_id, data)
);

create index idx_dieta_adesao_aluno_data on public.dieta_adesao(aluno_id, data);

create trigger trg_dieta_adesao_updated_at
  before update on public.dieta_adesao
  for each row execute function public.set_updated_at();

alter table public.dieta_adesao enable row level security;

create policy "aluno gerencia a própria adesão à dieta"
  on public.dieta_adesao for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê a adesão à dieta dos alunos"
  on public.dieta_adesao for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

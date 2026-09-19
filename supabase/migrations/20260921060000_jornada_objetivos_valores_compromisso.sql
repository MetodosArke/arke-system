-- Portando "Minha Jornada" do app original: objetivos (com revisão
-- trimestral guiada), valores-guia (exercício gamificado de 3 etapas) e
-- compromisso semanal (metas da semana vinculadas a objetivos/valores).
-- No original essas tabelas eram 100% privadas do aluno (nem staff via);
-- aqui mantemos a leitura do aluno e ADICIONAMOS visão do staff da
-- organização, consistente com o resto do sistema (checkins, calendário
-- de treino, adesão à dieta já são visíveis pro staff acompanhar).
create table public.aluno_objetivos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  aluno_id         uuid not null references public.alunos(id) on delete cascade,
  objetivos        text[] not null default '{}',
  conquistas       text,
  dificuldades     text,
  visao_3_meses    text,
  visao_3_anos     text,
  proxima_revisao  date,
  created_at       timestamptz not null default now()
);

create index idx_aluno_objetivos_aluno on public.aluno_objetivos(aluno_id, created_at desc);

alter table public.aluno_objetivos enable row level security;

create policy "aluno gerencia os próprios objetivos"
  on public.aluno_objetivos for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê os objetivos dos alunos"
  on public.aluno_objetivos for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create table public.aluno_valores (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  aluno_id         uuid not null references public.alunos(id) on delete cascade,
  valores          text[] not null default '{}',
  validade         date,
  created_at       timestamptz not null default now()
);

create index idx_aluno_valores_aluno on public.aluno_valores(aluno_id, created_at desc);

alter table public.aluno_valores enable row level security;

create policy "aluno gerencia os próprios valores-guia"
  on public.aluno_valores for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê os valores-guia dos alunos"
  on public.aluno_valores for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create table public.compromisso_semanal (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  aluno_id         uuid not null references public.alunos(id) on delete cascade,
  semana           text not null,
  created_at       timestamptz not null default now(),
  unique (aluno_id, semana)
);

alter table public.compromisso_semanal enable row level security;

create policy "aluno gerencia o próprio compromisso semanal"
  on public.compromisso_semanal for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê o compromisso semanal dos alunos"
  on public.compromisso_semanal for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create table public.compromisso_metas (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  compromisso_id      uuid not null references public.compromisso_semanal(id) on delete cascade,
  texto               text not null,
  objetivo_vinculado  text,
  valor_vinculado     text,
  concluida           boolean not null default false,
  created_at          timestamptz not null default now()
);

alter table public.compromisso_metas enable row level security;

create policy "aluno gerencia as próprias metas do compromisso"
  on public.compromisso_metas for all to authenticated
  using (
    exists (
      select 1 from public.compromisso_semanal cs
      join public.alunos a on a.id = cs.aluno_id
      where cs.id = compromisso_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.compromisso_semanal cs
      join public.alunos a on a.id = cs.aluno_id
      where cs.id = compromisso_id and a.user_id = auth.uid()
    )
  );

create policy "staff da org vê as metas do compromisso dos alunos"
  on public.compromisso_metas for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

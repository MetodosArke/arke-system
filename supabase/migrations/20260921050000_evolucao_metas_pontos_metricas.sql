-- Portando do app original: sistema de metas + pontuação da avaliação
-- física (a cada nova medição, comparamos com a meta definida na anterior
-- e pontuamos: meta atingida = +20, superada = +30) e métricas
-- personalizadas (o professor pode criar campos extras de 0-10 por aluno,
-- ex.: "disposição", "postura"). Estende avaliacoes_fisicas em vez de criar
-- uma tabela paralela — já é o registro oficial de avaliação do sistema.
alter table public.avaliacoes_fisicas
  add column musculo_percentual   numeric(5,2),
  add column data_proxima_avaliacao date,
  add column meta_peso_kg         numeric(5,2),
  add column meta_peso_direcao    text check (meta_peso_direcao in ('manter', 'aumentar', 'diminuir')),
  add column meta_gordura_valor   numeric(5,2),
  add column meta_gordura_direcao text check (meta_gordura_direcao in ('manter', 'aumentar', 'diminuir')),
  add column meta_musculo_valor   numeric(5,2),
  add column meta_musculo_direcao text check (meta_musculo_direcao in ('manter', 'aumentar', 'diminuir')),
  add column pontos               integer not null default 0;

create table public.metricas_customizadas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  nome            text not null,
  criado_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.metricas_customizadas enable row level security;

create policy "staff da org gerencia métricas customizadas"
  on public.metricas_customizadas for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê as próprias métricas customizadas"
  on public.metricas_customizadas for select to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create table public.metrica_valores (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metrica_id      uuid not null references public.metricas_customizadas(id) on delete cascade,
  avaliacao_id    uuid not null references public.avaliacoes_fisicas(id) on delete cascade,
  valor           numeric(4,1) not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.metrica_valores enable row level security;

create policy "staff da org gerencia valores de métricas customizadas"
  on public.metrica_valores for all to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'))
  with check (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

create policy "aluno vê os próprios valores de métricas customizadas"
  on public.metrica_valores for select to authenticated
  using (
    exists (
      select 1 from public.avaliacoes_fisicas af
      join public.alunos a on a.id = af.aluno_id
      where af.id = avaliacao_id and a.user_id = auth.uid()
    )
  );

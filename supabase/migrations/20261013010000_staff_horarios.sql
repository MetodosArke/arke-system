-- Etapa 2 da frente de operação nativa da academia: horários/escala de
-- trabalho de cada profissional. Só o gestor (ou admin_arke) define a
-- escala; o próprio profissional só enxerga a própria.
create table public.staff_horarios (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  dia_semana      integer not null check (dia_semana between 1 and 7), -- 1=Seg...7=Dom, mesma convenção de turmas.dias_semana/alunos.dias_descanso
  hora_inicio     time not null,
  hora_fim        time not null check (hora_fim > hora_inicio),
  created_at      timestamptz not null default now()
);

create index idx_staff_horarios_organization_id on public.staff_horarios(organization_id);
create index idx_staff_horarios_user_id on public.staff_horarios(user_id);

alter table public.staff_horarios enable row level security;

create policy "gestor gerencia horários da equipe"
  on public.staff_horarios for all
  to authenticated
  using (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'))
  with check (public.has_org_role((select auth.uid()), organization_id, 'gestor') or public.has_role((select auth.uid()), 'admin_arke'));

create policy "profissional vê o próprio horário"
  on public.staff_horarios for select
  to authenticated
  using (user_id = (select auth.uid()));

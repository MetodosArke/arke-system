-- Módulo de Gestão de Studios e Turmas Fechadas.

create table public.turmas (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  nome              text not null,
  capacidade_maxima integer not null check (capacidade_maxima > 0),
  profissional_id   uuid references auth.users(id) on delete set null,
  horario_inicio    time not null,
  horario_fim       time not null check (horario_fim > horario_inicio),
  dias_semana       integer[] not null default '{}', -- 1=Seg ... 7=Dom, mesma convenção de alunos.dias_descanso
  ativa             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_turmas_organization on public.turmas(organization_id);
create index idx_turmas_profissional on public.turmas(profissional_id);

create type public.agendamento_status as enum ('agendado', 'presente', 'cancelado', 'lista_espera');

create table public.agendamentos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  turma_id          uuid not null references public.turmas(id) on delete cascade,
  aluno_id          uuid not null references public.alunos(id) on delete cascade,
  data              date not null,
  status            public.agendamento_status not null default 'agendado',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (turma_id, aluno_id, data)
);

create index idx_agendamentos_turma_data on public.agendamentos(turma_id, data);
create index idx_agendamentos_aluno on public.agendamentos(aluno_id);
create index idx_agendamentos_organization on public.agendamentos(organization_id);

-- -----------------------------------------------------------------
-- Anti-overbooking: um CHECK constraint comum não consegue expressar
-- "soma de linhas ativas <= capacidade_maxima" (é uma invariante entre
-- linhas, não da própria linha) — o mecanismo correto no Postgres para
-- isso é um trigger, que é o que implementamos aqui. Ao tentar
-- agendar/marcar presença além da capacidade da turma, a operação é
-- recusada com uma mensagem que o frontend usa para oferecer a lista de
-- espera em vez de travar silenciosamente.
-- -----------------------------------------------------------------
create or replace function public.verificar_capacidade_turma()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_capacidade  integer;
  v_ocupados    integer;
begin
  if new.status not in ('agendado', 'presente') then
    return new;
  end if;

  select capacidade_maxima into v_capacidade from public.turmas where id = new.turma_id;

  select count(*) into v_ocupados
    from public.agendamentos
    where turma_id = new.turma_id
      and data = new.data
      and status in ('agendado', 'presente')
      and id is distinct from new.id;

  if v_ocupados >= v_capacidade then
    raise exception 'Turma lotada para esta data. Use a lista de espera.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_agendamentos_capacidade
  before insert or update of status, data, turma_id on public.agendamentos
  for each row execute function public.verificar_capacidade_turma();

-- -----------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------
alter table public.turmas enable row level security;
alter table public.agendamentos enable row level security;

create policy "staff da org gerencia turmas"
  on public.turmas for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê as turmas da própria organização"
  on public.turmas for select
  to authenticated
  using (public.is_org_member((select auth.uid()), organization_id));

create policy "staff da org gerencia agendamentos"
  on public.agendamentos for all
  to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id))
  with check (public.is_org_staff((select auth.uid()), organization_id));

create policy "aluno vê os próprios agendamentos"
  on public.agendamentos for select
  to authenticated
  using (aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid())));

create policy "aluno cancela o próprio agendamento"
  on public.agendamentos for update
  to authenticated
  using (aluno_id in (select a.id from public.alunos a where a.user_id = (select auth.uid())))
  with check (status = 'cancelado');

-- -----------------------------------------------------------------
-- Redundância na catraca: um Studio libera o acesso só se, além de
-- assinatura em dia, o aluno tiver agendamento ativo para uma turma cujo
-- horário cobre o momento atual. Função de leitura simples (não
-- SECURITY DEFINER — chamada pela Edge Function com service_role, que já
-- ignora RLS).
-- -----------------------------------------------------------------
create or replace function public.aluno_possui_agendamento_ativo_agora(_aluno_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.agendamentos ag
    join public.turmas t on t.id = ag.turma_id
    where ag.aluno_id = _aluno_id
      and ag.data = current_date
      and ag.status in ('agendado', 'presente')
      and t.ativa
      and extract(isodow from current_date)::int = any (t.dias_semana)
      and current_time between t.horario_inicio and t.horario_fim
  );
$$;

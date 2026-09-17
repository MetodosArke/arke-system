-- =====================================================================
-- ARKE — FASE 4: R.O.T.A.® — Central de Atendimento "Minha Fila"
-- & Automações de SLA
-- =====================================================================

create extension if not exists pg_cron with schema extensions;

-- -----------------------------------------------------------------
-- 1. Registro de execução de treino (necessário para detectar faltas)
-- -----------------------------------------------------------------

create table public.registro_treino (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id        uuid not null references public.alunos(id) on delete cascade,
  treino_id       uuid references public.treinos(id) on delete set null,
  data            date not null default current_date,
  concluido       boolean not null default true,
  observacao      text,
  created_at      timestamptz not null default now(),
  unique (aluno_id, data)
);

create index idx_registro_treino_org on public.registro_treino(organization_id);
create index idx_registro_treino_aluno_data on public.registro_treino(aluno_id, data);

alter table public.registro_treino enable row level security;

create policy "aluno registra e vê os próprios treinos executados"
  on public.registro_treino for all to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = auth.uid()));

create policy "staff da org vê registros de treino dos seus alunos"
  on public.registro_treino for select to authenticated
  using (public.is_org_staff(auth.uid(), organization_id) or public.has_role(auth.uid(), 'admin_arke'));

-- -----------------------------------------------------------------
-- 2. Agenda de dias de descanso do aluno (evita falso positivo na
--    automação de "2 treinos previstos sem registro")
--    1 = segunda ... 7 = domingo (ISO)
-- -----------------------------------------------------------------

alter table public.alunos
  add column dias_descanso int[] not null default '{}';

-- -----------------------------------------------------------------
-- 3. Gatilho: check-in com dor/desconforto → tarefa crítica imediata
-- -----------------------------------------------------------------

create or replace function public.gerar_tarefa_checkin_dor()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'com_dificuldade' and new.motivo_dificuldade = 'desconforto_dor' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento)
    values (
      new.organization_id,
      new.aluno_id,
      'Aluno relatou desconforto/dor no check-in',
      'critica',
      now() + interval '24 hours',
      'dor_checkin:' || new.id::text
    )
    on conflict (organization_id, origem_evento) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_checkins_gerar_tarefa_dor
  after insert on public.checkins
  for each row execute function public.gerar_tarefa_checkin_dor();

-- -----------------------------------------------------------------
-- 4. Automação (pg_cron diário): 2 dias previstos de treino sem
--    registro, respeitando os dias de descanso do aluno
-- -----------------------------------------------------------------

create or replace function public.gerar_tarefas_barreira_rotina()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _aluno record;
  _dias_previstos_sem_registro int;
begin
  for _aluno in
    select distinct a.id as aluno_id, a.organization_id, a.dias_descanso
    from public.alunos a
    join public.treinos t on t.aluno_id = a.id and t.status = 'ativo'
  loop
    -- conta, nos últimos 7 dias corridos (excluindo hoje), quantos dias
    -- NÃO são dia de descanso do aluno e NÃO têm registro de treino concluído
    select count(*)
    into _dias_previstos_sem_registro
    from generate_series(current_date - 7, current_date - 1, interval '1 day') as d(dia)
    where extract(isodow from d.dia)::int != all (
            case when _aluno.dias_descanso = '{}' then array[]::int[] else _aluno.dias_descanso end
          )
      and not exists (
        select 1 from public.registro_treino r
        where r.aluno_id = _aluno.aluno_id
          and r.data = d.dia::date
          and r.concluido = true
      );

    if _dias_previstos_sem_registro >= 2 then
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento)
      values (
        _aluno.organization_id,
        _aluno.aluno_id,
        'Aluno com 2+ dias previstos de treino sem registro (possível barreira de rotina)',
        'media',
        now() + interval '48 hours',
        'barreira_rotina:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW')
      )
      on conflict (organization_id, origem_evento) do nothing;
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'arke-barreira-rotina',
  '0 6 * * *',
  $$select public.gerar_tarefas_barreira_rotina();$$
);

revoke execute on function public.gerar_tarefas_barreira_rotina() from public, anon, authenticated;

-- -----------------------------------------------------------------
-- 5. Automação (pg_cron horário): escalonamento de SLA vencido
-- -----------------------------------------------------------------

alter table public.tarefas
  add column escalada_em timestamptz;

create or replace function public.escalar_tarefas_vencidas()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tarefas t
  set responsavel_id = (
        select om.user_id
        from public.organization_members om
        where om.organization_id = t.organization_id
          and om.role = 'gestor'
          and om.status = 'active'
        limit 1
      ),
      escalada_em = now()
  where t.status not in ('concluida', 'cancelada')
    and t.sla_prazo < now()
    and t.escalada_em is null
    and exists (
      select 1 from public.organization_members om
      where om.organization_id = t.organization_id
        and om.role = 'gestor'
        and om.status = 'active'
    );
end;
$$;

select cron.schedule(
  'arke-escalonamento-sla',
  '0 * * * *',
  $$select public.escalar_tarefas_vencidas();$$
);

revoke execute on function public.escalar_tarefas_vencidas() from public, anon, authenticated;

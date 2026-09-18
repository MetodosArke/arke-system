-- =====================================================================
-- ARKE — ETAPA 2: Painel Técnico (Personal Trainer & Nutricionista)
--
-- 1. Categoriza as tarefas por tipo de alerta (tarefa_tipo), para o
--    front-end poder exibir ícone/rótulo específico em "Minha Fila"
--    (novas anamneses M.A.P.A.®, dor/desconforto, barreira de rotina,
--    pedidos de ajuste, ativação pendente).
-- 2. Estende o gatilho de check-in (R.O.T.A.®) para também gerar
--    tarefa quando o aluno responde "Preciso de ajuste" ou "Quero
--    falar com alguém" — hoje só "com dor" gerava tarefa automática.
-- =====================================================================

create type public.tarefa_tipo as enum (
  'ativacao',
  'anamnese',
  'dor',
  'barreira',
  'ajuste',
  'outro'
);

alter table public.tarefas
  add column tipo public.tarefa_tipo not null default 'outro';

-- Backfill: classifica tarefas já existentes pelo prefixo de origem_evento.
update public.tarefas
set tipo = case
  when origem_evento like 'ativacao_pendente:%' then 'ativacao'
  when origem_evento like 'agendar_acolhimento:%' then 'anamnese'
  when origem_evento like 'dor_checkin:%' then 'dor'
  when origem_evento like 'barreira_rotina:%' then 'barreira'
  else 'outro'
end::public.tarefa_tipo;

-- -----------------------------------------------------------------
-- Passa a marcar o `tipo` nas automações que já existiam.
-- -----------------------------------------------------------------

create or replace function public.gerar_tarefas_ativacao_pendente()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  select
    a.organization_id,
    a.id,
    'Aluno sem 1º acesso após 48h',
    'alta',
    now() + interval '24 hours',
    'ativacao_pendente:' || a.id::text,
    'ativacao'
  from public.alunos a
  where a.primeiro_acesso_em is null
    and a.created_at < now() - interval '48 hours'
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;

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
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
      values (
        _aluno.organization_id,
        _aluno.aluno_id,
        'Aluno com 2+ dias previstos de treino sem registro (possível barreira de rotina)',
        'media',
        now() + interval '48 hours',
        'barreira_rotina:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW'),
        'barreira'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------
-- Estende o check-in R.O.T.A.®: além de "com dor" (crítica), agora
-- também sinaliza "preciso de ajuste" (média) e "quero falar com
-- alguém" (alta) como tarefas de atendimento — hoje só dor virava
-- tarefa automática, os outros dois pedidos ficavam sem alerta para
-- o profissional.
-- -----------------------------------------------------------------

create or replace function public.gerar_tarefa_checkin_dor()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'com_dificuldade' and new.motivo_dificuldade = 'desconforto_dor' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      new.organization_id,
      new.aluno_id,
      'Aluno relatou desconforto/dor no check-in',
      'critica',
      now() + interval '24 hours',
      'dor_checkin:' || new.id::text,
      'dor'
    )
    on conflict (organization_id, origem_evento) do nothing;
  elsif new.status = 'quero_falar_com_alguem' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      new.organization_id,
      new.aluno_id,
      'Aluno pediu para falar com alguém no check-in',
      'alta',
      now() + interval '24 hours',
      'ajuste_checkin:' || new.id::text,
      'ajuste'
    )
    on conflict (organization_id, origem_evento) do nothing;
  elsif new.status = 'preciso_ajuste' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      new.organization_id,
      new.aluno_id,
      'Aluno sinalizou que precisa de ajuste no plano',
      'media',
      now() + interval '48 hours',
      'ajuste_checkin:' || new.id::text,
      'ajuste'
    )
    on conflict (organization_id, origem_evento) do nothing;
  end if;
  return new;
end;
$$;

-- A tarefa que o próprio onboarding já cria ao concluir a anamnese
-- (src/pages/app/Onboarding.tsx, origem_evento agendar_acolhimento:<aluno_id>)
-- passa a ser classificada como 'anamnese' também nas novas inserções,
-- sem precisar de um novo gatilho no banco (o front-end já faz o insert).

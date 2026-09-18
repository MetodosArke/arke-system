-- Selamento e Expansão Comercial — Configuração de SLA Padrão
--
-- Centraliza os parâmetros de SLA (prioridade + prazo) que hoje estão
-- espalhados e hardcoded em funções/triggers distintos, para os 3 fluxos
-- pedidos no pacote de selamento. As funções abaixo passam a consultar
-- esta tabela em vez de usar `interval` literal — os demais gatilhos de
-- SLA do projeto (ativação pendente, "preciso de ajuste", "quero falar
-- com alguém") continuam com seus valores atuais, fora do escopo deste
-- pacote.
create table public.sla_config (
  tipo        public.tarefa_tipo primary key,
  prioridade  public.tarefa_prioridade not null,
  prazo_horas integer not null check (prazo_horas > 0),
  descricao   text,
  updated_at  timestamptz not null default now()
);

alter table public.sla_config enable row level security;

create policy "staff le a configuracao de sla"
  on public.sla_config for select
  to authenticated
  using (true);

create policy "admin_arke gerencia a configuracao de sla"
  on public.sla_config for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin_arke'))
  with check (public.has_role(auth.uid(), 'admin_arke'));

insert into public.sla_config (tipo, prioridade, prazo_horas, descricao) values
  ('dor',      'critica', 12, 'Relato de dor/desconforto no check-in — revisão profissional antes do próximo treino'),
  ('barreira', 'media',   24, 'Barreira de rotina — 2+ dias previstos de treino sem registro'),
  ('anamnese', 'media',   48, 'Nova anamnese M.A.P.A.® concluída — agendar consulta de acolhimento')
on conflict (tipo) do update set
  prioridade = excluded.prioridade,
  prazo_horas = excluded.prazo_horas,
  descricao = excluded.descricao,
  updated_at = now();

-- Gatilho de check-in com dor: passa a ler prioridade/prazo de sla_config
-- para o ramo 'desconforto_dor' (os ramos 'ajuste' seguem com seus
-- próprios valores, inalterados).
create or replace function public.gerar_tarefa_checkin_dor()
returns trigger language plpgsql set search_path = public as $$
declare
  _cfg record;
begin
  if new.status = 'com_dificuldade' and new.motivo_dificuldade = 'desconforto_dor' then
    select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'dor';
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      new.organization_id, new.aluno_id,
      'Aluno relatou desconforto/dor no check-in',
      coalesce(_cfg.prioridade, 'critica'),
      now() + make_interval(hours => coalesce(_cfg.prazo_horas, 12)),
      'dor_checkin:' || new.id::text,
      'dor'
    )
    on conflict (organization_id, origem_evento) do nothing;
  elsif new.status = 'quero_falar_com_alguem' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values (
      new.organization_id, new.aluno_id,
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
      new.organization_id, new.aluno_id,
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

-- Barreira de rotina: passa a ler prioridade/prazo de sla_config (tipo='barreira').
create or replace function public.gerar_tarefas_barreira_rotina()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _aluno record;
  _dias_previstos_sem_registro int;
  _cfg record;
begin
  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'barreira';

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
        coalesce(_cfg.prioridade, 'media'),
        now() + make_interval(hours => coalesce(_cfg.prazo_horas, 24)),
        'barreira_rotina:' || _aluno.aluno_id::text || ':' || to_char(current_date, 'IYYY-IW'),
        'barreira'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end if;
  end loop;
end;
$$;

-- Elite: descrição passa a citar explicitamente a fila prioritária de SLA.
update public.planos_atacado
  set descricao = 'Integrado + acolhimento expandido, jornada de hábitos, encontros periódicos, fila de atendimento com SLA prioritário e acompanhamento humano proativo'
  where id = 'elite';

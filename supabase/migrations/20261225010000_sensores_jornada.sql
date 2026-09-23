-- Fase 2 do Ecossistema: os sensores da jornada (23/09/2026).
--
-- `current_date` aqui **e** a data de Brasilia: o fuso do banco passou a
-- America/Sao_Paulo em 23/09/2026, e e por isso que nao ha conversao explicita
-- em nenhuma destas funcoes.
--
-- Sem tela e sem automação: esta migration só faz o sistema **enxergar**. O
-- motor de avanço automático (Fase 3) e a fila do Mentor Centralizado (Fase 4)
-- leem daqui. Separar assim é de propósito — um sensor errado que já move
-- aluno de fase é muito mais caro de descobrir do que um sensor errado que
-- ninguém consultou ainda.

-- ═══ 1. Última atividade no app ════════════════════════════════════════════
--
-- A regra de inércia do conceito é "sem abrir o app ou sem check-in por 5
-- dias". A segunda metade o sistema já sabia; a primeira, não — não havia
-- nada rastreando abertura de app. `primeiro_acesso_em` é de uma vez só.
--
-- Gravado por RPC e não por UPDATE do cliente pelo mesmo motivo de
-- `registrar_primeiro_acesso_aluno`: o aluno tem apenas SELECT na policy de
-- `alunos`, e o update seria **descartado em silêncio** pelo RLS — o campo
-- ficaria nulo para todo mundo e a automação de inércia abriria tarefa para
-- quem está usando o app todo dia.
alter table public.alunos
  add column if not exists ultima_atividade_em timestamptz;

comment on column public.alunos.ultima_atividade_em is
  'Ultima vez que o aluno abriu o app. Gravado por registrar_atividade_aluno(); o RLS descarta UPDATE direto do cliente.';

create or replace function public.registrar_atividade_aluno()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Freio de 15 minutos: o app chama isto a cada carga, e sem o freio seriam
  -- milhares de UPDATE por dia para responder a uma pergunta cuja unidade é o
  -- dia. A condição mora no WHERE para custar uma ida só ao banco.
  update public.alunos
     set ultima_atividade_em = now()
   where user_id = auth.uid()
     and (ultima_atividade_em is null or ultima_atividade_em < now() - interval '15 minutes');
end;
$$;

comment on function public.registrar_atividade_aluno() is
  'Carimba a abertura do app para o aluno da sessao. Idempotente e com freio de 15 min.';

revoke execute on function public.registrar_atividade_aluno() from public;
grant execute on function public.registrar_atividade_aluno() to authenticated;

/**
 * Dias desde o último sinal de vida do aluno.
 *
 * Considera abertura de app, presença (catraca ou QR), treino registrado e
 * check-in respondido — o conceito fala de "abrir o app OU check-in", e usar
 * só um dos sinais acusaria inércia de quem treina todo dia mas não navega.
 * Devolve NULL para quem nunca deu sinal nenhum: é caso de ativação, não de
 * inércia, e as duas têm tratamento diferente.
 */
create or replace function public.aluno_dias_inativo(_aluno_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when u.ultimo is null then null
           else (current_date - u.ultimo)::integer
         end
    from (
      select greatest(
               (select a.ultima_atividade_em at time zone 'America/Sao_Paulo' from public.alunos a where a.id = _aluno_id)::date,
               (select max(p.dia) from public.presencas p where p.aluno_id = _aluno_id),
               (select max(r.data) from public.registro_treino r where r.aluno_id = _aluno_id and r.concluido),
               (select max(c.data) from public.checkins c where c.aluno_id = _aluno_id)
             ) as ultimo
    ) u;
$$;

comment on function public.aluno_dias_inativo(uuid) is
  'Dias desde o ultimo sinal do aluno (app, presenca, treino ou check-in). NULL quando nunca houve sinal — isso e ativacao, nao inercia.';

-- ═══ 2. Constância contra a meta do próprio aluno ══════════════════════════
--
-- O conceito pede "80% de presença em 4 semanas". Medido contra a **meta do
-- aluno**, não contra um número absoluto: é a diretriz de Constância vs.
-- Adesão do projeto — quem tem meta de 2 treinos por semana e cumpre os dois
-- fez 100%, e não pode ser penalizado frente a quem treina 6.
--
-- A semana corrente fica de fora: ela está pela metade, e incluí-la puxaria a
-- média para baixo por um motivo que não é do aluno.
create or replace function public.aluno_constancia(_aluno_id uuid, _semanas integer default 4)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  with meta as (
    select greatest(coalesce(a.meta_semanal_dias, 3), 1) as dias
      from public.alunos a
     where a.id = _aluno_id
  ),
  semanas as (
    select date_trunc('week', current_date::timestamp)::date - (n * 7) as inicio
      from generate_series(1, greatest(_semanas, 1)) as n
  ),
  contagem as (
    select s.inicio,
           (
             select count(distinct d.dia)
               from (
                 select p.dia from public.presencas p
                  where p.aluno_id = _aluno_id and p.dia >= s.inicio and p.dia < s.inicio + 7
                 union
                 select r.data from public.registro_treino r
                  where r.aluno_id = _aluno_id and r.concluido
                    and r.data >= s.inicio and r.data < s.inicio + 7
               ) d
           ) as dias
      from semanas s
  )
  -- Cada semana vale no máximo 100%: treinar 6 vezes com meta de 2 não
  -- compensa uma semana em que o aluno não apareceu.
  select round(avg(least(c.dias::numeric / m.dias, 1)) * 100, 1)
    from contagem c, meta m;
$$;

comment on function public.aluno_constancia(uuid, integer) is
  'Constancia media das ultimas N semanas completas, medida contra a meta semanal do proprio aluno. Cada semana vale no maximo 100%.';

-- ═══ 3. Dor bloqueia a progressão ══════════════════════════════════════════
--
-- O check-in com dor já abria tarefa (`gerar_tarefa_checkin_dor`). O registro
-- de treino com `sensacao = 'dor'` **não disparava nada** — o aluno relatava
-- dor ao fim do treino e o sistema seguia como se nada fosse.
--
-- O conceito pede duas coisas: a progressão para imediatamente e o caso vai
-- para o Mentor. O bloqueio é um carimbo no aluno; desfazê-lo é decisão de
-- gente, nunca do tempo passar.
alter table public.alunos
  add column if not exists progressao_bloqueada_em timestamptz,
  add column if not exists progressao_bloqueada_motivo text;

comment on column public.alunos.progressao_bloqueada_em is
  'Progressao de fase e de carga suspensa (relato de dor). Liberada por liberar_progressao_aluno(); o tempo sozinho nao desfaz.';

create or replace function public.bloquear_progressao_por_dor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _org uuid;
begin
  if new.sensacao is distinct from 'dor' then
    return new;
  end if;

  update public.alunos
     set progressao_bloqueada_em = now(),
         progressao_bloqueada_motivo = 'Relato de dor no registro de treino'
   where id = new.aluno_id
     -- Não reabre o carimbo de um bloqueio que já existe: a data tem de ser a
     -- do primeiro relato, senão cada treino novo empurra o caso para a frente.
     and progressao_bloqueada_em is null
  returning organization_id into _org;

  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
  values (
    new.organization_id, new.aluno_id,
    'Aluno relatou dor ao registrar o treino — progressão suspensa',
    'critica',
    now() + interval '12 hours',
    'dor_treino:' || new.id::text,
    'dor'
  )
  on conflict (organization_id, origem_evento) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_bloquear_progressao_por_dor on public.registro_treino;
create trigger trg_bloquear_progressao_por_dor
  after insert or update of sensacao on public.registro_treino
  for each row execute function public.bloquear_progressao_por_dor();

revoke execute on function public.bloquear_progressao_por_dor() from public;

/** Só gente libera: equipe da academia ou ArkeFit, com o motivo no histórico. */
create or replace function public.liberar_progressao_aluno(_aluno_id uuid, _observacao text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _org uuid;
begin
  select organization_id into _org from public.alunos where id = _aluno_id;
  if _org is null then
    raise exception 'Aluno não encontrado.' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null
     and not (public.is_org_staff(auth.uid(), _org)
              or public.has_role(auth.uid(), 'admin_arke')
              or public.has_role(auth.uid(), 'superadmin')) then
    raise exception 'Só a equipe da academia ou a ArkeFit liberam a progressão.' using errcode = '42501';
  end if;

  update public.alunos
     set progressao_bloqueada_em = null,
         progressao_bloqueada_motivo = null
   where id = _aluno_id;

  insert into public.aluno_observacoes (organization_id, aluno_id, autor_id, texto)
  values (_org, _aluno_id, auth.uid(),
          coalesce(nullif(trim(_observacao), ''), 'Progressão liberada após avaliação do relato de dor.'));
end;
$$;

revoke execute on function public.liberar_progressao_aluno(uuid, text) from public;
grant execute on function public.liberar_progressao_aluno(uuid, text) to authenticated, service_role;

-- ═══ 4. Estouro de ciclo ═══════════════════════════════════════════════════
--
-- "O prazo do ciclo expira mas o aluno fez menos de 50% dos check-ins
-- exigidos." O início do ciclo é a entrada na fase atual, que
-- `aluno_fase_historico` já registra; quem nunca mudou de fase conta da
-- matrícula. Sem coluna nova: o histórico é a fonte, e duplicá-lo criaria
-- duas verdades que divergem na primeira correção manual.
create or replace function public.aluno_fase_desde(_aluno_id uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
           (select max(h.created_at at time zone 'America/Sao_Paulo')::date
              from public.aluno_fase_historico h
             where h.aluno_id = _aluno_id),
           (select a.created_at at time zone 'America/Sao_Paulo' from public.alunos a where a.id = _aluno_id)::date
         );
$$;

comment on function public.aluno_fase_desde(uuid) is
  'Quando o aluno entrou na fase atual. Sai do historico de fases; quem nunca mudou conta da matricula.';

/**
 * Ciclo estourado: passou do prazo e a constância ficou abaixo do mínimo.
 *
 * Devolve falso enquanto o prazo não venceu — o aluno ainda tem tempo, e
 * acusar antes transformaria a régua em ansiedade.
 */
create or replace function public.aluno_ciclo_estourado(
  _aluno_id uuid,
  _dias integer default 30,
  _minimo_pct numeric default 50
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select current_date - public.aluno_fase_desde(_aluno_id) >= _dias
     and coalesce(public.aluno_constancia(_aluno_id, greatest(_dias / 7, 1)), 0) < _minimo_pct;
$$;

comment on function public.aluno_ciclo_estourado(uuid, integer, numeric) is
  'Prazo do ciclo vencido com constancia abaixo do minimo. Falso enquanto o prazo nao venceu.';

revoke execute on function public.aluno_dias_inativo(uuid) from public;
revoke execute on function public.aluno_constancia(uuid, integer) from public;
revoke execute on function public.aluno_fase_desde(uuid) from public;
revoke execute on function public.aluno_ciclo_estourado(uuid, integer, numeric) from public;
grant execute on function public.aluno_dias_inativo(uuid) to authenticated, service_role;
grant execute on function public.aluno_constancia(uuid, integer) to authenticated, service_role;
grant execute on function public.aluno_fase_desde(uuid) to authenticated, service_role;
grant execute on function public.aluno_ciclo_estourado(uuid, integer, numeric) to authenticated, service_role;

-- Etapa L — Unificar a lógica de "dias que o aluno deveria treinar".
--
-- Antes desta migração existiam 3 conceitos paralelos que não se falavam:
--   1. alunos.dias_descanso        (dias de folga, usado só pela automação de barreira de rotina)
--   2. alunos.meta_semanal_dias    (contagem alvo, usada no card de progresso e na pontuação de engajamento)
--   3. aluno_rotina_semanal        (planejador dia a dia, introduzido na Etapa K)
--
-- A automação de SLA podia achar que o aluno "devia" ter treinado numa
-- quinta enquanto o card de progresso e a pontuação usavam outra conta
-- totalmente diferente. Esta migração centraliza a decisão em duas
-- funções auxiliares: quando o aluno configurou a Rotina Semanal, ela
-- manda; senão, cai para o comportamento antigo (dias_descanso /
-- meta_semanal_dias) sem quebrar quem nunca mexeu no planejador.

-- 1. "Esse dia da semana é esperado de treino pra esse aluno?" — usada
-- pela automação de barreira de rotina.
create or replace function public.dia_e_esperado_treino(_aluno_id uuid, _isodow integer, _dias_descanso integer[])
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  _dia_semana integer := _isodow % 7; -- 0=domingo..6=sábado, mesma convenção de aluno_rotina_semanal
  _tem_rotina boolean;
  _modalidade text;
begin
  select exists(select 1 from public.aluno_rotina_semanal where aluno_id = _aluno_id) into _tem_rotina;
  if _tem_rotina then
    select modalidade into _modalidade from public.aluno_rotina_semanal
      where aluno_id = _aluno_id and dia_semana = _dia_semana;
    return _modalidade is not null;
  end if;
  return not (_isodow = any(case when _dias_descanso = '{}' then array[]::int[] else _dias_descanso end));
end;
$$;

revoke execute on function public.dia_e_esperado_treino(uuid, integer, integer[]) from public;
grant execute on function public.dia_e_esperado_treino(uuid, integer, integer[]) to authenticated;

-- 2. "Quantos dias por semana esse aluno deveria treinar?" — usada na
-- pontuação de engajamento. Conta os dias com modalidade preenchida na
-- Rotina Semanal; se o aluno nunca configurou o planejador, cai para o
-- valor manual de meta_semanal_dias (comportamento anterior).
create or replace function public.obter_dias_previstos_semana(_aluno_id uuid, _meta_padrao integer)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  _tem_rotina boolean;
  _dias_planejados integer;
begin
  select exists(select 1 from public.aluno_rotina_semanal where aluno_id = _aluno_id) into _tem_rotina;
  if not _tem_rotina then
    return greatest(coalesce(_meta_padrao, 1), 1);
  end if;
  select count(*) into _dias_planejados from public.aluno_rotina_semanal
    where aluno_id = _aluno_id and modalidade is not null;
  return greatest(_dias_planejados, 1); -- nunca zero, pra não dividir por zero downstream
end;
$$;

revoke execute on function public.obter_dias_previstos_semana(uuid, integer) from public;
grant execute on function public.obter_dias_previstos_semana(uuid, integer) to authenticated;

-- 3. Automação de barreira de rotina passa a usar dia_e_esperado_treino
-- em vez de checar só dias_descanso diretamente.
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
    where public.dia_e_esperado_treino(_aluno.aluno_id, extract(isodow from d.dia)::int, _aluno.dias_descanso)
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

revoke execute on function public.gerar_tarefas_barreira_rotina() from public, anon, authenticated;

-- 4. Pontuação de engajamento passa a usar obter_dias_previstos_semana em
-- vez do hardcoded meta_semanal_dias * 4.
create or replace function public.obter_pontuacao_engajamento_mensal()
returns table (
  pontuacao_propria numeric,
  media_organizacao numeric,
  treinos_concluidos integer,
  checkins_registrados integer,
  adesao_dieta_media numeric,
  dias_meta_agua_batida integer,
  dias_no_mes integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _aluno_id uuid;
  _org_id uuid;
  _inicio date := date_trunc('month', current_date)::date;
  _fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  _dias_no_mes integer := extract(day from _fim)::integer;
begin
  select id, organization_id into _aluno_id, _org_id from public.alunos where user_id = auth.uid();
  if _aluno_id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  return query
  with pontuacoes as (
    select
      a.id as aluno_id,
      coalesce(rt.treinos_concluidos, 0) as treinos_concluidos,
      coalesce(ck.checkins_registrados, 0) as checkins_registrados,
      da.adesao_dieta_media,
      coalesce(rh.dias_meta_agua, 0) as dias_meta_agua_batida,
      least(1.0, coalesce(rt.treinos_concluidos, 0)::numeric / (public.obter_dias_previstos_semana(a.id, a.meta_semanal_dias) * 4)) * 40
        + least(1.0, coalesce(ck.checkins_registrados, 0)::numeric / 20) * 20
        + coalesce(da.adesao_dieta_media, 0) / 100 * 20
        + least(1.0, coalesce(rh.dias_meta_agua, 0)::numeric / greatest(1, _dias_no_mes)) * 20
        as pontuacao
    from public.alunos a
    left join (
      select rt2.aluno_id, count(*) as treinos_concluidos
      from public.registro_treino rt2
      where rt2.concluido = true and rt2.data between _inicio and _fim
      group by rt2.aluno_id
    ) rt on rt.aluno_id = a.id
    left join (
      select c.aluno_id, count(*) as checkins_registrados
      from public.checkins c
      where c.data between _inicio and _fim
      group by c.aluno_id
    ) ck on ck.aluno_id = a.id
    left join (
      select d.aluno_id, avg(d.adesao_percentual) as adesao_dieta_media
      from public.dieta_adesao d
      where d.data between _inicio and _fim
      group by d.aluno_id
    ) da on da.aluno_id = a.id
    left join (
      select rh2.aluno_id, count(*) as dias_meta_agua
      from public.registro_habito rh2
      join public.alunos a2 on a2.id = rh2.aluno_id
      where rh2.data between _inicio and _fim and rh2.agua_ml >= a2.meta_agua_ml
      group by rh2.aluno_id
    ) rh on rh.aluno_id = a.id
    where a.organization_id = _org_id
  )
  select
    (select p.pontuacao from pontuacoes p where p.aluno_id = _aluno_id),
    (select round(avg(p.pontuacao), 1) from pontuacoes p),
    (select p.treinos_concluidos from pontuacoes p where p.aluno_id = _aluno_id),
    (select p.checkins_registrados from pontuacoes p where p.aluno_id = _aluno_id),
    (select round(p.adesao_dieta_media, 1) from pontuacoes p where p.aluno_id = _aluno_id),
    (select p.dias_meta_agua_batida from pontuacoes p where p.aluno_id = _aluno_id),
    _dias_no_mes;
end;
$$;

revoke execute on function public.obter_pontuacao_engajamento_mensal() from public;
grant execute on function public.obter_pontuacao_engajamento_mensal() to authenticated;

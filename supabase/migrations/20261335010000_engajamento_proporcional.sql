-- A pontuação de engajamento do mês media o realizado até hoje contra a meta
-- do mês inteiro. No dia 5, um aluno que treinou tudo o que devia tinha uns
-- 15 de 40 pontos de treino, e todo aluno saía com engajamento baixo. Daí:
--
-- - o Gestão 360 mostrava a receita inteira como "MRR em risco" e a Retenção
--   enchia na primeira semana de todo mês;
-- - a rotina semanal (segunda, 05:00 de Brasília) abria chamado de
--   "engajamento baixo" para quase todo aluno do Método quando a segunda caía
--   na primeira semana do mês. Abriu um em 05/10/2026.
--
-- A meta passa a ser proporcional aos dias que já passaram no mês. No último
-- dia ela é a mesma de antes (4 semanas de treino, 20 check-ins e a meta de
-- água em todos os dias), então a pontuação de um mês fechado não muda.
--
-- A rotina não abre chamado antes do dia 7: com dois ou três dias de mês, um
-- treino a mais ou a menos decide a pontuação, e chamado aberto à toa vira
-- ruído na fila do Mentor.

create or replace function public.calcular_pontuacoes_engajamento_mes(_org_id uuid)
 returns table(aluno_id uuid, treinos_concluidos integer, checkins_registrados integer, adesao_dieta_media numeric, dias_meta_agua_batida integer, pontuacao numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  _inicio date := date_trunc('month', current_date)::date;
  _fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  _dias_no_mes integer := extract(day from _fim)::integer;
  -- Dias do mês até hoje, hoje incluído.
  _decorridos integer := (current_date - date_trunc('month', current_date)::date) + 1;
  _fracao numeric := _decorridos::numeric / _dias_no_mes;
begin
  return query
  select
    a.id,
    coalesce(rt.treinos_concluidos, 0)::integer,
    coalesce(ck.checkins_registrados, 0)::integer,
    da.adesao_dieta_media,
    coalesce(rh.dias_meta_agua, 0)::integer,
    least(1.0, coalesce(rt.treinos_concluidos, 0)::numeric / greatest(1.0, public.obter_dias_previstos_semana(a.id, a.meta_semanal_dias) * 4 * _fracao)) * 40
      + least(1.0, coalesce(ck.checkins_registrados, 0)::numeric / greatest(1.0, 20 * _fracao)) * 20
      + coalesce(da.adesao_dieta_media, 0) / 100 * 20
      + least(1.0, coalesce(rh.dias_meta_agua, 0)::numeric / greatest(1, _decorridos)) * 20
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
  where a.organization_id = _org_id;
end;
$function$;

create or replace function public.gerar_tarefas_engajamento_baixo()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _cfg record;
  _org record;
  _pontuacao record;
  _competencia text := to_char(current_date, 'YYYY-MM');
begin
  -- Antes do dia 7 o mês ainda não diz nada: ver o comentário do arquivo.
  if extract(day from current_date) < 7 then
    return;
  end if;

  select prioridade, prazo_horas into _cfg from public.sla_config where tipo = 'engajamento_baixo';

  for _org in select id from public.organizations loop
    for _pontuacao in
      select pc.aluno_id, pc.pontuacao
      from public.calcular_pontuacoes_engajamento_mes(_org.id) pc
      join public.alunos a on a.id = pc.aluno_id
      where a.metodo_arke_status = 'ativo' and a.situacao_academia = 'em_dia' and pc.pontuacao < 30
    loop
      insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
      values (
        _org.id,
        _pontuacao.aluno_id,
        'Engajamento baixo neste mês (treino, check-in, dieta e água) — considerar contato proativo',
        coalesce(_cfg.prioridade, 'media'),
        now() + make_interval(hours => coalesce(_cfg.prazo_horas, 72)),
        'engajamento_baixo:' || _pontuacao.aluno_id::text || ':' || _competencia,
        'engajamento_baixo'
      )
      on conflict (organization_id, origem_evento) do nothing;
    end loop;
  end loop;
end;
$function$;

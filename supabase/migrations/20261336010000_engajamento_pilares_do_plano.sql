-- A nota de engajamento conta só o que o aluno tem (decisão do responsável,
-- 05/10/2026). Ela tem quatro pilares, treino (40), check-in (20), dieta (20)
-- e água (20), e nasceu para o Método. O aluno do Free sem dieta da academia
-- não passava de 80, e quem fica abaixo de 40 conta como risco no Gestão 360
-- e na Retenção: numa academia sem nutricionista, o painel mostrava risco
-- onde não havia.
--
-- Sem dieta ativa, a nota é refeita sobre treino, check-in e água (os 80
-- pontos viram 100). O aluno do Método segue com os quatro, porque a dieta
-- dele é do mentor e faz parte do que ele comprou. A meta proporcional aos
-- dias do mês (20261335010000) continua.

set lock_timeout = '5s';

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
    (
      least(1.0, coalesce(rt.treinos_concluidos, 0)::numeric / greatest(1.0, public.obter_dias_previstos_semana(a.id, a.meta_semanal_dias) * 4 * _fracao)) * 40
      + least(1.0, coalesce(ck.checkins_registrados, 0)::numeric / greatest(1.0, 20 * _fracao)) * 20
      + least(1.0, coalesce(rh.dias_meta_agua, 0)::numeric / greatest(1, _decorridos)) * 20
    ) * case when a.metodo_arke_status = 'ativo' or dt.aluno_id is not null then 1.0 else 100.0 / 80 end
      + case when a.metodo_arke_status = 'ativo' or dt.aluno_id is not null then coalesce(da.adesao_dieta_media, 0) / 100 * 20 else 0 end
  from public.alunos a
  left join (
    select distinct d2.aluno_id
    from public.dietas d2
    where d2.status = 'ativo'
  ) dt on dt.aluno_id = a.id
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

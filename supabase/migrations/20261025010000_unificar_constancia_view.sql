-- Etapa N (auditoria de integração) — a view org_churn_metrics
-- (consumida por Gestão 360° e Retenção) calculava "constância" como
-- "treinou pelo menos uma vez nos últimos 7 dias, entre quem tem treino
-- ativo" — um cálculo totalmente à parte do que a automação de barreira
-- de rotina e a pontuação de engajamento usam (dia_e_esperado_treino /
-- obter_dias_previstos_semana, Etapa L). Um aluno podia aparecer "OK"
-- aqui e "em risco" na pontuação de engajamento ao mesmo tempo. Reescreve
-- pra usar a mesma função — agora é a média, por aluno, do percentual de
-- dias esperados de treino (conforme Rotina Semanal ou dias_descanso)
-- efetivamente cumpridos nos últimos 7 dias.
create or replace view public.org_churn_metrics
with (security_invoker = true)
as
with constancia_por_aluno as (
  select
    t.organization_id,
    t.aluno_id,
    (
      select count(*) from generate_series(current_date - 6, current_date, interval '1 day') d(dia)
      where public.dia_e_esperado_treino(t.aluno_id, extract(isodow from d.dia)::int, a.dias_descanso)
        and exists (
          select 1 from public.registro_treino r
          where r.aluno_id = t.aluno_id and r.data = d.dia::date and r.concluido = true
        )
    )::numeric
    /
    nullif((
      select count(*) from generate_series(current_date - 6, current_date, interval '1 day') d(dia)
      where public.dia_e_esperado_treino(t.aluno_id, extract(isodow from d.dia)::int, a.dias_descanso)
    ), 0) * 100 as pct
  from public.treinos t
  join public.alunos a on a.id = t.aluno_id
  where t.status = 'ativo'
)
select
  o.id as organization_id,
  o.nome as organization_nome,
  (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'mapa') as alunos_fase_mapa,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'base') as alunos_fase_base,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'rota') as alunos_fase_rota,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'apex') as alunos_fase_apex,
  (select count(*) from public.alunos a where a.organization_id = o.id and a.fase_jornada = 'legado') as alunos_fase_legado,
  (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'ativa') as assinaturas_ativas,
  (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'cancelada' and s.updated_at >= date_trunc('month', now())) as cancelamentos_mes_atual,
  coalesce(round((select avg(c.pct) from constancia_por_aluno c where c.organization_id = o.id), 1), 0) as constancia_pct_7d
from public.organizations o;

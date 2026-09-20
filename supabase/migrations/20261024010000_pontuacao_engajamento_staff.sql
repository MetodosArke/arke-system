-- Etapa M — Levar a Pontuação de Engajamento para o staff.
--
-- A pontuação de engajamento (Etapa K) só existia no app do aluno — a
-- equipe (Gestão 360°/Retenção) não tinha nenhuma visibilidade sobre
-- quem estava caindo de engajamento antes de virar cancelamento. Extrai
-- a fórmula pra uma função compartilhada e expõe uma versão por-aluno
-- (staff-only) além da versão "própria + média" que o aluno já usava.

-- 1. Fórmula compartilhada — calcula a pontuação de todos os alunos de
-- uma organização no mês corrente. Não é exposta diretamente (sem grant
-- a authenticated): só é chamada de dentro das duas funções abaixo, que
-- já checam permissão antes.
create or replace function public.calcular_pontuacoes_engajamento_mes(_org_id uuid)
returns table (
  aluno_id uuid,
  treinos_concluidos integer,
  checkins_registrados integer,
  adesao_dieta_media numeric,
  dias_meta_agua_batida integer,
  pontuacao numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _inicio date := date_trunc('month', current_date)::date;
  _fim date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  _dias_no_mes integer := extract(day from _fim)::integer;
begin
  return query
  select
    a.id,
    coalesce(rt.treinos_concluidos, 0)::integer,
    coalesce(ck.checkins_registrados, 0)::integer,
    da.adesao_dieta_media,
    coalesce(rh.dias_meta_agua, 0)::integer,
    least(1.0, coalesce(rt.treinos_concluidos, 0)::numeric / (public.obter_dias_previstos_semana(a.id, a.meta_semanal_dias) * 4)) * 40
      + least(1.0, coalesce(ck.checkins_registrados, 0)::numeric / 20) * 20
      + coalesce(da.adesao_dieta_media, 0) / 100 * 20
      + least(1.0, coalesce(rh.dias_meta_agua, 0)::numeric / greatest(1, _dias_no_mes)) * 20
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
$$;

revoke execute on function public.calcular_pontuacoes_engajamento_mes(uuid) from public, anon, authenticated;

-- 2. Versão do aluno (própria pontuação + média da organização) — mesmo
-- contrato de antes, agora só delegando pra fórmula compartilhada.
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
  _dias_no_mes integer := extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::integer;
begin
  select id, organization_id into _aluno_id, _org_id from public.alunos where user_id = auth.uid();
  if _aluno_id is null then
    raise exception 'Cadastro de aluno não encontrado.';
  end if;

  return query
  with pontuacoes as (
    select * from public.calcular_pontuacoes_engajamento_mes(_org_id)
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

-- 3. Versão do staff — pontuação individual de cada aluno da própria
-- organização, pra Gestão 360°/Retenção identificarem quem está caindo
-- de engajamento antes de virar cancelamento. Só staff (via
-- organization_members) enxerga; nomes/perfis são resolvidos no
-- frontend, junto das outras queries que já fazem esse join.
create or replace function public.obter_engajamento_alunos_organizacao()
returns table (
  aluno_id uuid,
  treinos_concluidos integer,
  checkins_registrados integer,
  adesao_dieta_media numeric,
  dias_meta_agua_batida integer,
  pontuacao numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _org_id uuid;
begin
  select organization_id into _org_id
  from public.organization_members
  where user_id = auth.uid() and status = 'active'
  limit 1;

  if _org_id is null then
    raise exception 'Sem organização vinculada.';
  end if;

  return query select * from public.calcular_pontuacoes_engajamento_mes(_org_id);
end;
$$;

revoke execute on function public.obter_engajamento_alunos_organizacao() from public;
grant execute on function public.obter_engajamento_alunos_organizacao() to authenticated;

-- Auditoria de integração (rodada 3) — achado #1, o mais crítico: o "MRR"
-- em Gestão 360° e nos RPCs do SuperAdmin considerava só assinaturas do
-- Método ARKE (aluno_assinaturas), ignorando por completo a receita de
-- mensalidade dos Planos da Academia (aluno_matriculas_academia +
-- planos_academia) — pra academia tradicional com baixa adesão ao
-- Método, o dashboard financeiro podia mostrar uma fração da receita
-- real, ou zero. Normaliza planos não-mensais (trimestral/semestral/
-- anual) pro equivalente mensal antes de somar.
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
),
mensalidade_mensal_equiv as (
  select
    m.organization_id,
    m.aluno_id,
    m.status,
    m.updated_at,
    case p.periodicidade
      when 'mensal' then m.valor_cobrado
      when 'trimestral' then m.valor_cobrado / 3
      when 'semestral' then m.valor_cobrado / 6
      when 'anual' then m.valor_cobrado / 12
    end as valor_mensal_equivalente
  from public.aluno_matriculas_academia m
  join public.planos_academia p on p.id = m.plano_id
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
  (
    (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'ativa')
    + (select count(*) from public.aluno_matriculas_academia m where m.organization_id = o.id and m.status = 'ativa')
  ) as assinaturas_ativas,
  (
    (select count(*) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'cancelada' and s.updated_at >= date_trunc('month', now()))
    + (select count(*) from public.aluno_matriculas_academia m where m.organization_id = o.id and m.status = 'cancelada' and m.updated_at >= date_trunc('month', now()))
  ) as cancelamentos_mes_atual,
  coalesce(round((select avg(c.pct) from constancia_por_aluno c where c.organization_id = o.id), 1), 0) as constancia_pct_7d,
  coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'ativa'), 0) as mrr_arke,
  coalesce((select sum(me.valor_mensal_equivalente) from mensalidade_mensal_equiv me where me.organization_id = o.id and me.status = 'ativa'), 0) as mrr_academia,
  coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s where s.organization_id = o.id and s.status = 'ativa'), 0)
    + coalesce((select sum(me.valor_mensal_equivalente) from mensalidade_mensal_equiv me where me.organization_id = o.id and me.status = 'ativa'), 0) as mrr_total
from public.organizations o;

-- O mesmo problema existia nos RPCs do SuperAdmin (mrr_global e
-- mrr_organizacao) — corrige do mesmo jeito.
drop function if exists public.get_superadmin_overview();

create function public.get_superadmin_overview()
returns table (
  mrr_global              numeric,
  arr_global              numeric,
  take_rate_pct           numeric,
  inadimplencia_pct       numeric,
  academias_total         bigint,
  academias_ativas        bigint,
  retencao_tenants_pct    numeric,
  alunos_ativos_global    bigint,
  prescricoes_base_total  bigint,
  checkins_mapa_total     bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_receita_total        numeric;
  v_repasse_total        numeric;
  v_assinaturas_total    bigint;
  v_assinaturas_atrasadas bigint;
  v_academias_total      bigint;
  v_academias_canceladas bigint;
  v_mrr_arke             numeric;
  v_mrr_academia         numeric;
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  select coalesce(sum(valor), 0), coalesce(sum(valor_repasse_arke), 0)
    into v_receita_total, v_repasse_total
    from public.pagamentos
    where status = 'confirmado';

  select count(*), count(*) filter (where status = 'atrasada')
    into v_assinaturas_total, v_assinaturas_atrasadas
    from public.aluno_assinaturas;

  select count(*), count(*) filter (where status = 'cancelado')
    into v_academias_total, v_academias_canceladas
    from public.organizations;

  select coalesce(sum(valor_cobrado), 0) into v_mrr_arke from public.aluno_assinaturas where status = 'ativa';

  select coalesce(sum(
    case p.periodicidade
      when 'mensal' then m.valor_cobrado
      when 'trimestral' then m.valor_cobrado / 3
      when 'semestral' then m.valor_cobrado / 6
      when 'anual' then m.valor_cobrado / 12
    end
  ), 0) into v_mrr_academia
  from public.aluno_matriculas_academia m
  join public.planos_academia p on p.id = m.plano_id
  where m.status = 'ativa';

  return query
  select
    v_mrr_arke + v_mrr_academia as mrr_global,
    (v_mrr_arke + v_mrr_academia) * 12 as arr_global,
    case when v_receita_total > 0
      then round(v_repasse_total / v_receita_total * 100, 2)
      else 0 end as take_rate_pct,
    case when v_assinaturas_total > 0
      then round(v_assinaturas_atrasadas::numeric / v_assinaturas_total::numeric * 100, 2)
      else 0 end as inadimplencia_pct,
    v_academias_total as academias_total,
    (select count(*) from public.organizations where status = 'ativo') as academias_ativas,
    case when v_academias_total > 0
      then round((v_academias_total - v_academias_canceladas)::numeric / v_academias_total::numeric * 100, 2)
      else 0 end as retencao_tenants_pct,
    (select count(*) from public.alunos) as alunos_ativos_global,
    (select count(*) from public.treinos where status = 'ativo')
      + (select count(*) from public.dietas where status = 'ativo') as prescricoes_base_total,
    (select count(*) from public.checkins) as checkins_mapa_total;
end;
$$;

revoke execute on function public.get_superadmin_overview() from public;
grant execute on function public.get_superadmin_overview() to authenticated;

drop function if exists public.get_superadmin_tenants();

create function public.get_superadmin_tenants()
returns table (
  organization_id       uuid,
  nome                   text,
  slug                   text,
  status                 public.org_status,
  plano_b2b              public.plano_b2b,
  tipo                   public.organization_tipo,
  created_at             timestamptz,
  alunos_total           bigint,
  mrr_organizacao        numeric,
  assinaturas_atrasadas  bigint,
  ultima_atividade       timestamptz,
  cnpj_cpf               text,
  telefone               text,
  trial_vencimento       date,
  gestor_email           text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select
    o.id as organization_id,
    o.nome,
    o.slug,
    o.status,
    o.plano_b2b,
    o.tipo,
    o.created_at,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s
              where s.organization_id = o.id and s.status = 'ativa'), 0)
    + coalesce((select sum(
        case p.periodicidade
          when 'mensal' then m.valor_cobrado
          when 'trimestral' then m.valor_cobrado / 3
          when 'semestral' then m.valor_cobrado / 6
          when 'anual' then m.valor_cobrado / 12
        end
      ) from public.aluno_matriculas_academia m
      join public.planos_academia p on p.id = m.plano_id
      where m.organization_id = o.id and m.status = 'ativa'), 0) as mrr_organizacao,
    (select count(*) from public.aluno_assinaturas s
      where s.organization_id = o.id and s.status = 'atrasada')
    + (select count(*) from public.mensalidades me
      where me.organization_id = o.id and me.status = 'atrasado') as assinaturas_atrasadas,
    greatest(
      (select max(c.created_at) from public.checkins c where c.organization_id = o.id),
      (select max(t.created_at) from public.treinos t where t.organization_id = o.id)
    ) as ultima_atividade,
    o.cnpj_cpf,
    o.telefone,
    o.trial_vencimento,
    (
      select u.email::text
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
      order by m.created_at asc
      limit 1
    ) as gestor_email
  from public.organizations o
  order by o.created_at desc;
end;
$$;

revoke execute on function public.get_superadmin_tenants() from public;
grant execute on function public.get_superadmin_tenants() to authenticated;

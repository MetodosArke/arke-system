-- Etapa 6, Stage 3: Painel Super Admin (Visão Master ArkeFit)
--
-- Visão 360° da plataforma mãe, restrita a usuários com o papel global
-- 'superadmin' (tabela user_roles). Em vez de ampliar as políticas de RLS
-- das tabelas de tenant para permitir leitura cross-organization, expomos
-- RPCs SECURITY DEFINER que verificam o papel internamente (mesmo padrão
-- de has_role/has_org_role/is_org_staff já usado no projeto) — assim o
-- RLS de cada tabela continua estritamente escopado por organization_id.

-- =====================================================================
-- 1. Visão geral global (MRR, ARR, Take Rate, Inadimplência, Health Score B2B, uso)
-- =====================================================================
create or replace function public.get_superadmin_overview()
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

  return query
  select
    coalesce((select sum(valor_cobrado) from public.aluno_assinaturas where status = 'ativa'), 0) as mrr_global,
    coalesce((select sum(valor_cobrado) from public.aluno_assinaturas where status = 'ativa'), 0) * 12 as arr_global,
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

grant execute on function public.get_superadmin_overview() to authenticated;

-- =====================================================================
-- 2. Gestão de tenants: lista de academias com métricas por organização
-- =====================================================================
create or replace function public.get_superadmin_tenants()
returns table (
  organization_id       uuid,
  nome                   text,
  slug                   text,
  status                 public.org_status,
  plano_b2b              public.plano_b2b,
  created_at             timestamptz,
  alunos_total           bigint,
  mrr_organizacao        numeric,
  assinaturas_atrasadas  bigint
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
    o.created_at,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s
              where s.organization_id = o.id and s.status = 'ativa'), 0) as mrr_organizacao,
    (select count(*) from public.aluno_assinaturas s
      where s.organization_id = o.id and s.status = 'atrasada') as assinaturas_atrasadas
  from public.organizations o
  order by o.created_at desc;
end;
$$;

grant execute on function public.get_superadmin_tenants() to authenticated;

-- =====================================================================
-- 3. Gestão de tenants: bloqueio manual e alteração de plano master
-- =====================================================================
create policy "superadmin gerencia organizations"
  on public.organizations for update
  to authenticated
  using (public.has_role(auth.uid(), 'superadmin'))
  with check (public.has_role(auth.uid(), 'superadmin'));

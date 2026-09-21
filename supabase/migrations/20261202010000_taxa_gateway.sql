-- Taxa do Asaas: repassada no preço de atacado e descontada da receita.
--
-- O sandbox mostrou que, com `fixedValue` para a academia no split, o Asaas
-- desconta a taxa de processamento do que sobra — ou seja, da parte da
-- ArkeFit. Dos R$ 119 do Integrado, a academia recebia os R$ 74 inteiros e a
-- ArkeFit R$ 42,15 em vez de R$ 45. E `valor_repasse_arke` gravava os R$ 45
-- cheios, então receita, take rate e MRR da Visão Master mostravam dinheiro
-- que não entra.
--
-- Decisão da ArkeFit (21/09/2026): a taxa entra no preço de atacado. O repasse
-- do Método passa a ser custo de atacado + taxa de processamento sobre o
-- valor que a academia cobra — a mesma taxa configurável (Visão Master →
-- Configurações) que a mensalidade de plano próprio já usa. Calculada sobre o
-- valor cobrado, e não embutida num custo fixo, porque a academia define o
-- varejo livremente e a parte percentual da taxa acompanha esse valor: um
-- custo fixo só acertaria no preço sugerido.
--
-- E a receita passa a ser líquida: cada pagamento guarda a taxa que o Asaas de
-- fato descontou (`value - netValue` do próprio evento), que é a verdade —
-- a configurada é só a estimativa usada para montar o split.

-- 1) Taxa real, por cobrança. Nula até o primeiro evento que traga netValue.
alter table public.pagamentos
  add column if not exists taxa_gateway numeric(10,2) check (taxa_gateway is null or taxa_gateway >= 0);
alter table public.mensalidades
  add column if not exists taxa_gateway numeric(10,2) check (taxa_gateway is null or taxa_gateway >= 0);
alter table public.cobrancas_b2b
  add column if not exists taxa_gateway numeric(10,2) check (taxa_gateway is null or taxa_gateway >= 0);

comment on column public.pagamentos.taxa_gateway is
  'Taxa que o Asaas descontou desta cobrança (value - netValue do evento). Sai da parte da ArkeFit: receita líquida = valor_repasse_arke - taxa_gateway.';
comment on column public.mensalidades.taxa_gateway is
  'Taxa que o Asaas descontou desta cobrança (value - netValue do evento). Sai da parte da ArkeFit.';
comment on column public.cobrancas_b2b.taxa_gateway is
  'Taxa que o Asaas descontou desta cobrança B2B (value - netValue do evento).';

-- 2) Repasse travado na assinatura do Método, como a matrícula de plano
-- próprio já faz: o split fica fixo no Asaas desde a criação, então o webhook
-- não pode recalculá-lo com o custo ou a taxa de hoje.
alter table public.aluno_assinaturas
  add column if not exists valor_repasse_arke numeric(10,2);

comment on column public.aluno_assinaturas.valor_repasse_arke is
  'Parte da ArkeFit fixada no split do Asaas na criação: custo de atacado + taxa de processamento estimada sobre valor_cobrado. Nula em assinaturas anteriores a 21/09/2026 (o webhook cai no custo de atacado).';

-- 3) A taxa de processamento estimada, num lugar só. Legível pela equipe da
-- academia (a tela de precificação mostra a margem já descontada dela); a
-- tabela plataforma_config continua restrita à ArkeFit.
create or replace function public.arke_taxa_processamento(_valor numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(
    coalesce(_valor, 0) * coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_percentual'), 0) / 100
    + coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_fixa'), 0),
    2
  );
$$;

revoke execute on function public.arke_taxa_processamento(numeric) from public, anon;
grant execute on function public.arke_taxa_processamento(numeric) to authenticated, service_role;

-- 4) Receita líquida na Visão Master. `repasse_arke` passa a ser o que de fato
-- fica com a ArkeFit depois da taxa do Asaas; cobrança sem taxa conhecida
-- (evento antigo, sem netValue) entra pelo repasse gravado.
create or replace function public.get_superadmin_receita_historica(_meses integer default 12)
returns table(mes date, receita_metodo_arke numeric, receita_mensalidades numeric, receita_b2b numeric,
              receita_total numeric, repasse_arke numeric, mrr_contratado numeric, arr_contratado numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_meses integer := least(greatest(coalesce(_meses, 12), 1), 36);
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  with meses as (
    select generate_series(
             date_trunc('month', current_date) - make_interval(months => v_meses - 1),
             date_trunc('month', current_date),
             interval '1 month'
           )::date as mes
  ),
  pag as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)) as repasse
      from public.pagamentos
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  mens as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)) as repasse
      from public.mensalidades
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  b2b as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(valor - coalesce(taxa_gateway, 0)) as repasse
      from public.cobrancas_b2b
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  snap as (
    select distinct on (date_trunc('month', data))
           date_trunc('month', data)::date as mes,
           mrr_global,
           arr_global
      from public.metricas_mrr_snapshot
     order by date_trunc('month', data), data desc
  )
  select
    m.mes,
    coalesce(p.bruto, 0)::numeric,
    coalesce(mn.bruto, 0)::numeric,
    coalesce(b.bruto, 0)::numeric,
    (coalesce(p.bruto, 0) + coalesce(mn.bruto, 0) + coalesce(b.bruto, 0))::numeric,
    (coalesce(p.repasse, 0) + coalesce(mn.repasse, 0) + coalesce(b.repasse, 0))::numeric,
    s.mrr_global,
    s.arr_global
  from meses m
  left join pag p on p.mes = m.mes
  left join mens mn on mn.mes = m.mes
  left join b2b b on b.mes = m.mes
  left join snap s on s.mes = m.mes
  order by m.mes;
end;
$function$;

-- 5) Take rate líquido no overview: parte da ArkeFit depois da taxa sobre o bruto.
create or replace function public.get_superadmin_overview()
returns table(mrr_global numeric, arr_global numeric, take_rate_pct numeric, inadimplencia_pct numeric,
              academias_total bigint, academias_ativas bigint, retencao_tenants_pct numeric,
              alunos_ativos_global bigint, prescricoes_base_total bigint, checkins_mapa_total bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

  select coalesce(sum(valor), 0), coalesce(sum(coalesce(valor_repasse_arke, 0) - coalesce(taxa_gateway, 0)), 0)
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
$function$;

-- Receita B2B só entra na série com liquidação comprovada.
--
-- A parte B2B da série era a única que somava por `status = 'confirmado'`
-- sozinho, caindo em `created_at` quando `data_pagamento` era nulo — enquanto
-- `pagamentos` e `mensalidades` sempre exigiram `data_pagamento is not null`.
-- Na prática isso deixava qualquer cobrança marcada como confirmada na mão
-- virar receita realizada, com a data de emissão fazendo as vezes de data de
-- caixa. Foi o que aconteceu com uma cobrança de teste: R$ 5 apareceram no
-- painel como receita de setembro sem nenhum dinheiro ter entrado.
--
-- Com a exigência de `data_pagamento`, a fonte da data de caixa passa a ser
-- uma só em todas as três origens: o webhook do Asaas, que grava a data
-- quando o pagamento é confirmado de verdade.

create or replace function public.get_superadmin_receita_historica(_meses integer default 12)
returns table (
  mes date,
  receita_metodo_arke numeric,
  receita_mensalidades numeric,
  receita_b2b numeric,
  receita_total numeric,
  repasse_arke numeric,
  mrr_contratado numeric,
  arr_contratado numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
           sum(coalesce(valor_repasse_arke, 0)) as repasse
      from public.pagamentos
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  mens as (
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto,
           sum(coalesce(valor_repasse_arke, 0)) as repasse
      from public.mensalidades
     where status = 'confirmado' and data_pagamento is not null
     group by 1
  ),
  b2b as (
    -- Cobrança B2B é a ARKE cobrando a academia: o valor inteiro é receita
    -- da ARKE, por isso entra também no repasse. A data é a da liquidação,
    -- nunca a da emissão — receita realizada tem que cair no mês em que o
    -- dinheiro entrou, e cobrança sem data de pagamento não entrou.
    select date_trunc('month', data_pagamento)::date as mes,
           sum(valor) as bruto
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
    (coalesce(p.repasse, 0) + coalesce(mn.repasse, 0) + coalesce(b.bruto, 0))::numeric,
    s.mrr_global,
    s.arr_global
  from meses m
  left join pag p on p.mes = m.mes
  left join mens mn on mn.mes = m.mes
  left join b2b b on b.mes = m.mes
  left join snap s on s.mes = m.mes
  order by m.mes;
end;
$$;

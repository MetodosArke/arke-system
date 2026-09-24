-- Taxa de processamento com piso (24/09/2026).
--
-- O sandbox do Asaas recusou uma cobrança de R$ 5 com "o valor total do Split
-- R$ 4,36 excede o valor a receber da cobrança R$ 4,01". A taxa que a ArkeFit
-- retém é estimada como 2,99% + R$ 0,49 — a do cartão —, mas boleto e PIX
-- custam R$ 1,99 fixos por cobrança (conferido em /myAccount/fees nas contas de
-- produção e sandbox; R$ 0,99 com o desconto promocional até 08/12/2026). A
-- estimativa só alcança R$ 1,99 a partir de R$ 50,17: abaixo disso a parte da
-- academia no split passa do que sobra depois da taxa, e o Asaas recusa criar a
-- cobrança. Hoje isso já barra cobrança abaixo de ~R$ 17; depois da promoção,
-- barraria toda cobrança abaixo de ~R$ 50 — taxa de matrícula, diária e
-- mensalidade de plano barato.
--
-- O piso é a taxa fixa do boleto e do PIX. Acima de R$ 50,17 nada muda.
-- Configurável em Visão Master → Configurações, como as outras duas partes.
-- Assinaturas já criadas mantêm o split travado na criação.

insert into public.plataforma_config (chave, valor, descricao)
select 'taxa_processamento_minima', 1.99,
       'Taxa mínima por cobrança (R$): a taxa fixa do boleto e do PIX no Asaas. Abaixo dela, o split da academia passa do valor líquido e o Asaas recusa a cobrança.'
where not exists (select 1 from public.plataforma_config where chave = 'taxa_processamento_minima');

create or replace function public.arke_taxa_processamento(_valor numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(_valor, 0) <= 0 then 0
    else round(greatest(
      _valor * coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_percentual'), 0) / 100
        + coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_fixa'), 0),
      coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_minima'), 0)
    ), 2)
  end;
$$;

-- O tipo de retorno ganha uma coluna, e isso exige recriar a função. As telas
-- leem as colunas pelo nome, então a coluna nova não quebra quem ainda não a lê.
drop function if exists public.arke_taxa_processamento_config();
create function public.arke_taxa_processamento_config()
returns table (percentual numeric, fixa numeric, minima numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_percentual'), 0),
    coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_fixa'), 0),
    coalesce((select valor from public.plataforma_config where chave = 'taxa_processamento_minima'), 0);
$$;

revoke execute on function public.arke_taxa_processamento_config() from public, anon;
grant execute on function public.arke_taxa_processamento_config() to authenticated, service_role;

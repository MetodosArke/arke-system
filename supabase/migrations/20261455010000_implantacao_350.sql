-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Implantação oficial de R$ 350 (reunião de 10/11/2026). É a referência que o site
-- mostra (planos_b2b_site) e que a Visão Master sugere ao emitir; o valor de cada
-- academia continua livre (TaxaImplantacaoOrganizacao), para desconto ou abono.
update public.plataforma_config set valor = 350, updated_at = now() where chave = 'taxa_implantacao_referencia';

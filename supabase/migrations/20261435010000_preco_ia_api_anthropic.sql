set lock_timeout = '5s';

-- O Vigia e o assistente podem responder pela API da Anthropic (decisão de
-- 09/10/2026, `_shared/iaAnthropic.ts`), e o medidor de uso grava o modelo
-- que de fato respondeu: `claude-sonnet-4-6`. Sem esta linha, a tela de uso
-- mostraria essas chamadas "sem preço". O preço é o da tabela pública da API,
-- igual ao do perfil global do Bedrock; dentro do crédito mensal do plano,
-- ele sai do crédito, e não do cartão.
insert into public.ia_precos (modelo, entrada_usd_por_milhao, saida_usd_por_milhao, conferido_em, fonte) values
  ('claude-sonnet-4-6', 3.00, 15.00, '2026-10-09', 'Tabela de preços da API da Anthropic (sai do crédito mensal enquanto houver)')
on conflict (modelo) do nothing;

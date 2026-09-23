-- Valores novos para o ciclo de vida da assinatura (23/09/2026).
--
-- Migration própria, separada da que os usa, porque o PostgreSQL não deixa um
-- valor de enum recém-criado ser referenciado na mesma transação — e o corpo
-- de uma função SQL é validado no CREATE, não só na chamada.
--
-- `pausada`: a assinatura existe e não emite cobrança. Faltava, e sem ela
-- pausar um aluno não tinha como parar a cobrança dele — o aluno saía do app
-- e seguia pagando.
--
-- `cancelado` em `pagamento_status`: cobrança **removida**, que é coisa
-- diferente de `estornado` (dinheiro devolvido). O Asaas manda `PAYMENT_DELETED`
-- nos dois casos de remoção, e tratá-los como estorno confundia "não há o que
-- pagar" com "houve devolução".
alter type public.assinatura_status add value if not exists 'pausada';
alter type public.pagamento_status add value if not exists 'cancelado';

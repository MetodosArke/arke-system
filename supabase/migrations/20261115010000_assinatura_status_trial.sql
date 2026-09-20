-- Trial do Método ARKE (B2C), espelhando o que já existe no B2B.
--
-- No B2B, `organizations.status = 'trial'` marca o tenant de homologação:
-- ele usa a plataforma inteira, tem prazo (`trial_vencimento`) e nunca é
-- bloqueado por pendência financeira, porque não é cliente comercial.
-- Aqui o equivalente para a assinatura do aluno.
--
-- Em migration separada porque o Postgres não permite usar um valor de enum
-- recém-criado na mesma transação em que ele é adicionado.
alter type public.assinatura_status add value if not exists 'trial';

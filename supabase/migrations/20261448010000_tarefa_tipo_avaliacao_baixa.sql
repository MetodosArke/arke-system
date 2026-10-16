set lock_timeout = '5s';

-- Tipo de tarefa da pesquisa de satisfação (NPS) do app do aluno (16/10/2026):
-- a nota de 0 a 6 vira a tarefa "Avaliação baixa do aluno", da gestão.
--
-- Arquivo separado de propósito, como o de `equipamento` (20261243010000): o
-- Postgres não deixa usar um valor novo de enum na mesma transação em que ele
-- foi criado, e a migration seguinte (20261449010000) já o usa na regra de
-- dono da tarefa.
alter type public.tarefa_tipo add value if not exists 'avaliacao_baixa';

-- Tipo de tarefa para o que só acontece no equipamento da academia: apagar do
-- leitor da catraca o usuário, a digital ou o cartão de um aluno.
--
-- Arquivo separado de propósito: o Postgres não deixa usar um valor novo de
-- enum na mesma transação em que ele foi criado, e a migration seguinte já o
-- usa em funções e na regra de dono da tarefa.
alter type public.tarefa_tipo add value if not exists 'equipamento';

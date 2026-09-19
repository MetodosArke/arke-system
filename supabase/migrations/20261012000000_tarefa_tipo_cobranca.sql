-- Novo tipo de tarefa pra cobrança de mensalidade atrasada (ver
-- migração seguinte). Precisa estar em transação própria: ALTER TYPE
-- ... ADD VALUE não pode ser referenciado na mesma transação em que é
-- criado.
alter type public.tarefa_tipo add value if not exists 'cobranca';

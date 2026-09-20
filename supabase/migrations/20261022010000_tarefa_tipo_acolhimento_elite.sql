-- Novo tipo de tarefa pra acolhimento expandido Elite (ver migração
-- seguinte). Precisa estar em transação própria: ALTER TYPE ... ADD VALUE
-- não pode ser referenciado na mesma transação em que é criado.
alter type public.tarefa_tipo add value if not exists 'acolhimento_elite';

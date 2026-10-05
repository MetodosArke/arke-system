-- Índices das três chaves estrangeiras que o conselheiro de desempenho do
-- Supabase acusou sem índice (05/10/2026). As tabelas são pequenas hoje; o
-- índice evita a varredura inteira quando a conta apontada é apagada e quando
-- a fila de suporte filtra pelo responsável.

set lock_timeout = '5s';

create index if not exists chamados_suporte_responsavel_id_idx on public.chamados_suporte (responsavel_id);
create index if not exists chamados_suporte_user_id_idx on public.chamados_suporte (user_id);
create index if not exists equipe_arkefit_atualizado_por_idx on public.equipe_arkefit (atualizado_por);

-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Tipos novos de tarefa para o Mentor Centralizado.
--
-- Migration propria: o PostgreSQL nao deixa um valor de enum recem-criado ser
-- usado na mesma transacao, e o corpo de funcao SQL e validado no CREATE.
alter type public.tarefa_tipo add value if not exists 'inercia';
alter type public.tarefa_tipo add value if not exists 'ciclo_travado';
alter type public.tarefa_tipo add value if not exists 'instrucao_presencial';

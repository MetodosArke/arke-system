-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Toda cobrança nova nasce com vencimento preenchido, venha de onde vier.
-- asaas-emitir-cobranca-b2b manda `dueDate: hojeISO()` ao Asaas, então
-- current_date reproduz exatamente a data que o gateway conhece.
--
-- Default em vez de campo explícito na Edge Function de propósito: a regra
-- de bloqueio passa a valer para qualquer caminho de inserção, sem depender
-- de alguém lembrar de preencher a coluna nem de um redeploy.
alter table public.cobrancas_b2b
  alter column vencimento set default current_date;

alter table public.cobrancas_b2b
  alter column vencimento set not null;

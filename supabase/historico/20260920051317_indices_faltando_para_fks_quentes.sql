-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Índices em FKs sem cobertura, flagrados pelos performance advisors nas
-- tabelas mais quentes do sistema (acessos_catraca_logs, dietas, treinos,
-- lancamentos_financeiros). Sem índice, qualquer join/delete/RLS check
-- que filtra por essas colunas faz sequential scan.
create index if not exists idx_acessos_catraca_logs_aluno_id
  on public.acessos_catraca_logs (aluno_id);

create index if not exists idx_acessos_catraca_logs_confirmado_por
  on public.acessos_catraca_logs (confirmado_por);

create index if not exists idx_dietas_publicado_por
  on public.dietas (publicado_por);

create index if not exists idx_lancamentos_financeiros_registrado_por
  on public.lancamentos_financeiros (registrado_por);

create index if not exists idx_treinos_publicado_por
  on public.treinos (publicado_por);

-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Gatilho de risco de evasao para a fila do Mentor.
--
-- 06:10 UTC: depois do avanco de fases (05:45), para nao abrir chamado de
-- inercia sobre um aluno que a varredura acabou de mover de fase, e junto com
-- as demais rotinas que abrem tarefa pela manha — a celula comeca o dia com a
-- fila ja montada.
select cron.schedule(
  'arke-inercia-mentor',
  '10 6 * * *',
  $$ select public.gerar_tarefas_inercia() $$
);

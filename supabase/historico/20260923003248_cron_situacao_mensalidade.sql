-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Rede de seguranca diaria: reflete na situacao do aluno o que a cobranca diz.
--
-- 05:30 UTC de proposito: depois da reconciliacao Asaas<->banco (04:30), que
-- conserta o PAYMENT_CONFIRMED perdido, e antes das rotinas que abrem tarefa
-- pela manha (06:00 em diante). Na ordem inversa, um aluno que pagou seria
-- marcado inadimplente de manha e so voltaria no dia seguinte.
select cron.schedule(
  'arke-situacao-mensalidade',
  '30 5 * * *',
  $$ select public.sincronizar_situacao_por_mensalidade() $$
);

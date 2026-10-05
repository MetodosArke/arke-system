-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- Varredura diaria do avanco automatico de fases.
--
-- 05:45 UTC de proposito, na ordem que importa: depois da reconciliacao
-- Asaas<->banco (04:30) e da sincronizacao de situacao por mensalidade
-- (05:30), e antes das rotinas que abrem tarefa pela manha (06:00 em diante).
--
-- A ordem nao e estetica: `motivo_nao_avanca` recusa quem nao esta `em_dia`,
-- entao rodar ANTES da sincronizacao suspenderia o avanco de um aluno que
-- pagou na vespera e cuja situacao ainda nao tinha sido corrigida.
select cron.schedule(
  'arke-avanco-fases',
  '45 5 * * *',
  $$ select public.varrer_avanco_fases() $$
);

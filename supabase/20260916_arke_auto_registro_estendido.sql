-- Fase 2 (gamificação, Sessão A do plano, primeira fatia) — auto-registro
-- estendido do aluno. treino_calendario, dieta_adesao,
-- compromisso_semanal e compromisso_metas já têm organization_id/RLS
-- desde a Fase 0 (20260916_modulo_arke_fase0_multitenant.sql) mas nunca
-- foram religadas ao app — só falta este campo novo em checkin_diario.
--
-- D-A1 (confirmado com o usuário): "horas de sono" vira um campo diário
-- novo, preenchido junto com a dedicação do dia — avaliacao_semanal.sono
-- continua sendo a nota subjetiva semanal, um conceito diferente.
alter table public.checkin_diario add column horas_sono numeric;

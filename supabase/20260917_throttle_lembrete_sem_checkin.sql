-- Corrige achado de auditoria: o lembrete "sem check-in" (7 e 3 dias) em
-- arkeLembretes.ts não tinha nenhuma deduplicação/throttle e repetia a
-- mesma notificação todo santo dia enquanto o aluno não fizesse check-in
-- de novo (30, 60, 90+ notificações pra uma situação só). Esta coluna
-- guarda quando o último lembrete desse tipo foi enviado, pra limitar a
-- no máximo 1 por semana por aluno.
alter table public.aluno_arke_licenca add column ultimo_lembrete_checkin_em timestamptz;

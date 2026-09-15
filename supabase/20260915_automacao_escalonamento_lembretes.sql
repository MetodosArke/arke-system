-- Fase 7 (Automação): gatilhos, lembretes, escalonamento — sem duplicação.
-- CLAUDE.md seção 9, item 7. As regras em si (evento de origem,
-- condições, ação, prioridade, responsável, prazo, limite de repetição,
-- condição de encerramento — seção 6) ficam declaradas em código
-- (server/automacao.ts), não configuráveis por painel ainda.

-- Escalonamento de tarefa vencida precisa de um contador para respeitar
-- um limite de repetição (nunca escalar indefinidamente).
alter table public.atendimentos
  add column if not exists escalonamentos_count int not null default 0;

-- Nova origem para a regra "aluno sem check-in há N dias" — reaproveita
-- o mesmo índice único (aluno_id, origem) já criado na Fase 6 para
-- nunca duplicar tarefa aberta.
alter table public.atendimentos drop constraint atendimentos_origem_check;
alter table public.atendimentos add constraint atendimentos_origem_check
  check (origem in ('check_in', 'pedido_direto', 'manual', 'sem_checkin'));

-- Lembrete de convite de aluno pendente: limite de repetição = 1
-- (nunca reenviar mais de uma vez).
alter table public.member_invitations
  add column if not exists lembrete_enviado_em timestamptz;

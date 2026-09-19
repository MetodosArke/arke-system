-- Resolve o "app vazio" do primeiro acesso (feedback direto de academias
-- parceiras): hoje, ao concluir o onboarding M.A.P.A.®, o aluno só ganha
-- uma tarefa interna pra staff agendar o acolhimento — nada visível pra
-- ele, e nenhum treino até o professor publicar manualmente. Isso abre
-- risco de desengajamento nas primeiras 24-48h.
--
-- Esta migration só adiciona a coluna que falta pro staff registrar QUANDO
-- o acolhimento foi marcado, sem precisar encerrar a tarefa (o desfecho
-- continua sendo só depois que o encontro realmente acontece — ciclo
-- completo de atendimento não muda). O aluno passa a ver essa data real no
-- lugar do texto estático "em breve" no dashboard.
alter table public.tarefas add column data_agendada timestamptz;

comment on column public.tarefas.data_agendada is
  'Data/hora combinada com o aluno para a tarefa em questão (ex.: consulta de acolhimento M.A.P.A.®) — preenchida pelo staff ao agendar, independente do encerramento da tarefa (que só ocorre com desfecho_acao, após o encontro acontecer).';

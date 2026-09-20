-- Correção crítica: a liberação da catraca checava inadimplência da
-- assinatura do Método ARKE (aluno_assinaturas), não do plano da
-- academia (aluno_matriculas_academia + mensalidades) — a maioria dos
-- alunos, que nunca aderiu ao Método, nunca tem linha em
-- aluno_assinaturas, então a catraca liberava sempre, independente de
-- estar pagando a mensalidade da academia. O controle de acesso físico é
-- da academia, não do produto de coaching. Ver
-- supabase/functions/catraca-validar-acesso/index.ts.
--
-- Corrige junto um bug de logging pré-existente: os resultados
-- 'negado_sem_agendamento' e 'negado_falha_verificacao_agendamento' (já
-- usados pela edge function na redundância de turma de Studio) nunca
-- estiveram na constraint de check da tabela — todo INSERT desses casos
-- violava o CHECK e falhava silenciosamente (a função não checava o
-- erro do insert), perdendo o registro de auditoria desses acessos
-- negados.
alter table public.acessos_catraca_logs drop constraint acessos_catraca_logs_resultado_check;
alter table public.acessos_catraca_logs add constraint acessos_catraca_logs_resultado_check
  check (resultado in (
    'liberado',
    'negado_inadimplente',
    'negado_nao_encontrado',
    'negado_catraca_inativa',
    'negado_sem_agendamento',
    'negado_falha_verificacao_agendamento'
  ));

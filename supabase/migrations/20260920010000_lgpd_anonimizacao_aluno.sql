-- Ajustes de acabamento operacional — Política de Exclusão e
-- Anonimização LGPD (soft delete).
--
-- Em vez de DELETE FROM alunos (que quebraria a integridade referencial
-- com aluno_assinaturas/pagamentos, necessária para auditoria fiscal),
-- o fluxo de anonimização atualiza profiles/organization_members no
-- lugar e marca `alunos.anonimizado_em`. Os dados financeiros (Asaas
-- subscription/payment IDs, valores) permanecem intocados.
alter table public.alunos
  add column if not exists anonimizado_em timestamptz;

comment on column public.alunos.anonimizado_em is
  'Data/hora em que os dados pessoais deste aluno foram anonimizados (LGPD). Nulo = aluno ativo/normal. O registro em si nunca é excluído, para preservar o histórico financeiro (aluno_assinaturas/pagamentos) para auditoria fiscal/contábil.';

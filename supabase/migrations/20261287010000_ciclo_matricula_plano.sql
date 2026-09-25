-- Ciclo de vida da mensalidade do plano da academia (24/09/2026).
--
-- Matricular o aluno num plano da academia criava a assinatura no Asaas, e
-- dali em diante o painel não tinha como pausar, cancelar nem mudar o valor
-- dela: o ciclo de vida existia só para o Método ARKE. A assinatura mora na
-- conta Asaas da ArkeFit (é ela que faz o split), então a academia também não
-- alcançava pelo painel do Asaas. Quem trancasse ou saísse do plano seguia
-- sendo cobrado até alguém excluir o aluno.
--
-- `asaas-assinatura-ciclo` passa a atender o plano também; aqui ficam as
-- colunas que registram quem pausou ou cancelou, e por quê.

alter table public.aluno_matriculas_academia
  add column if not exists pausada_em timestamptz,
  add column if not exists pausada_por uuid,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid,
  add column if not exists cancelamento_motivo text;

-- Uma matrícula viva por aluno, contando a pausada. Com a trava só na ativa,
-- dava para matricular de novo quem estava com o plano pausado, e a
-- assinatura antiga ficava esperando alguém retomá-la: duas cobranças do
-- mesmo aluno.
drop index if exists public.uq_aluno_matricula_academia_ativa;
create unique index if not exists uq_aluno_matricula_academia_viva
  on public.aluno_matriculas_academia (aluno_id)
  where status <> 'cancelada';

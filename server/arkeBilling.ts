import { ARKE_ALUNO_WHOLESALE_CENTS, formatBRL } from "@shared/pricing";
import { createAsaasPayment } from "./asaas";
import { upsertAsaasPayment } from "./asaasPersistence";
import { getOrCreateAsaasCustomerForOrganization } from "./db";
import { countAlunosComArkeAtivo, listArkeModulesEnabled, markArkeRepasseCharged } from "./supabaseAdmin";
import { captureException } from "./_core/errorMonitoring";

// Repasse mensal do módulo Arke (regras comerciais combinadas com o
// usuário): a academia já cobra o aluno "Com Arke" junto da própria
// mensalidade dele, por fora do sistema. O que este job automatiza é só
// o outro lado — o repasse da academia PARA a Arke, no atacado (nº de
// alunos ativos no mês x R$59,90), como uma cobrança variável separada
// da mensalidade base e do pacote fixo do módulo (esses dois já têm seu
// próprio fluxo em saas.organizations.updateSubscription/updateArkeModule).
//
// Roda a cada execução do cron diário (automacaoCron.ts) mas só cobra
// 1x por mês por organização: a idempotência é o próprio
// last_repasse_charged_at, comparado por mês — não precisa checar se
// "hoje é dia 1", o primeiro cron do mês novo já resolve isso sozinho.
export type ArkeRepasseResultado = { organizacoesCobradas: number; organizacoesSemAlunoAtivo: number; falhas: number };

export async function runArkeRepasseMensal(): Promise<ArkeRepasseResultado> {
  const resultado: ArkeRepasseResultado = { organizacoesCobradas: 0, organizacoesSemAlunoAtivo: 0, falhas: 0 };
  const hoje = new Date();
  const mesAtual = hoje.toISOString().slice(0, 7);

  for (const arkeModule of await listArkeModulesEnabled()) {
    if (arkeModule.last_repasse_charged_at?.slice(0, 7) === mesAtual) continue;
    try {
      const alunosAtivos = await countAlunosComArkeAtivo(arkeModule.organization_id);
      if (alunosAtivos === 0) {
        resultado.organizacoesSemAlunoAtivo += 1;
        continue;
      }
      const customerId = await getOrCreateAsaasCustomerForOrganization(arkeModule.organization_id);
      const dueDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString().slice(0, 10);
      const payment = await createAsaasPayment({
        customer: customerId,
        value: (alunosAtivos * ARKE_ALUNO_WHOLESALE_CENTS) / 100,
        dueDate,
        billingType: "UNDEFINED",
        description: `Repasse Módulo Arke — ${alunosAtivos} aluno(s) com Arke x ${formatBRL(ARKE_ALUNO_WHOLESALE_CENTS)}`,
      });
      // Marca como cobrado no mês IMEDIATAMENTE após a cobrança real ser
      // criada no Asaas — antes de qualquer outra escrita. A cobrança em si
      // já é dinheiro real e irreversível por este job; se qualquer coisa
      // falhar depois disso, o próximo cron não pode tentar cobrar de novo.
      await markArkeRepasseCharged(arkeModule.organization_id, hoje.toISOString().slice(0, 10));
      resultado.organizacoesCobradas += 1;
      try {
        await upsertAsaasPayment(payment as unknown as Record<string, unknown>, "PAYMENT_CREATED", arkeModule.organization_id);
      } catch (persistError) {
        // Bookkeeping local, não a cobrança em si (já feita e já marcada
        // acima) — não conta como falha do job; o webhook do Asaas para
        // este mesmo pagamento reconcilia a linha depois.
        captureException(persistError, { job: "arke_repasse_mensal.upsertAsaasPayment", organizationId: arkeModule.organization_id, asaasPaymentId: (payment as { id?: string })?.id });
      }
    } catch (error) {
      captureException(error, { job: "arke_repasse_mensal", organizationId: arkeModule.organization_id });
      resultado.falhas += 1;
    }
  }
  return resultado;
}

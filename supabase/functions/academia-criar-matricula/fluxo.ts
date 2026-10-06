/**
 * Chamadas ao Asaas da matrícula no plano da academia, separadas do index.ts.
 *
 * Sem Deno e sem Supabase, como os outros `fluxo.ts`: o sandbox
 * (`npm run sandbox:conta-academia`) exercita este código, e não uma cópia.
 * Até 06/10/2026 elas moravam dentro do index.ts, e o sandbox não tinha como
 * chegar nelas.
 *
 * O cliente vem de `asaas-cobranca-avulsa/fluxo.ts` (`obterOuCriarCustomer`):
 * a mesma busca pelo id do aluno e depois pelo CPF, com a recusa do CPF em
 * branco, e na conta da academia a reativação dos avisos.
 */

import type { Split } from "../_shared/contaCobranca.ts";

export { obterOuCriarCustomer } from "../asaas-cobranca-avulsa/fluxo.ts";
export { assinaturaAtivaNoAsaas } from "../asaas-create-subscription/fluxo.ts";

export const CICLO_ASAAS: Record<string, string> = {
  mensal: "MONTHLY",
  trimestral: "QUARTERLY",
  semestral: "SEMIANNUALLY",
  anual: "YEARLY",
};

const descricaoErro = (corpo: { errors?: { description?: string }[] } | null | undefined) =>
  corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;

export type AssinaturaDoPlano = { id: string; value?: number; nextDueDate?: string; customer?: string };

/**
 * Cria a assinatura da mensalidade. `split` nulo é a conta da própria
 * academia: ela recebe o valor inteiro, e split para a própria carteira o
 * Asaas recusa. Com split, a academia recebe o valor fixo e a taxa de
 * processamento fica na conta da ArkeFit, como sempre foi.
 *
 * Quem chama já procurou a assinatura órfã pela referência (`plano:<aluno>`)
 * e recusou: diferente do Método, a do plano não se adota, porque pode ser de
 * outro plano ou outro valor.
 */
export async function criarAssinaturaDoPlano(
  api: string,
  chave: string,
  dados: {
    customerId: string;
    valor: number;
    periodicidade: string;
    primeiroVencimento: string;
    descricao: string;
    referencia: string;
    split: Split[] | null;
  },
): Promise<{ ok: true; assinatura: AssinaturaDoPlano } | { ok: false; erro: string }> {
  const resp = await fetch(`${api}/subscriptions`, {
    signal: AbortSignal.timeout(20_000),
    method: "POST",
    headers: { "Content-Type": "application/json", access_token: chave },
    body: JSON.stringify({
      customer: dados.customerId,
      billingType: "UNDEFINED",
      value: dados.valor,
      cycle: CICLO_ASAAS[dados.periodicidade] ?? "MONTHLY",
      nextDueDate: dados.primeiroVencimento,
      description: dados.descricao,
      externalReference: dados.referencia,
      ...(dados.split ? { split: dados.split } : {}),
    }),
  });
  let corpo: (AssinaturaDoPlano & { errors?: { code?: string; description?: string }[] }) | null = null;
  try {
    corpo = await resp.json();
  } catch {
    // corpo vazio ou não-JSON
  }
  if (!resp.ok || !corpo?.id) {
    console.error("Asaas: falha ao criar assinatura", resp.status, corpo?.errors?.map((e) => e.code) ?? []);
    return { ok: false, erro: descricaoErro(corpo) ?? "Falha ao criar assinatura no Asaas." };
  }
  return { ok: true, assinatura: corpo };
}

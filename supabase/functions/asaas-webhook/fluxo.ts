/**
 * Regras do webhook do Asaas que não dependem do banco nem do Deno, para o
 * teste do app exercitar este código e não uma cópia — o mesmo critério dos
 * outros `fluxo.ts`.
 */

export type OrigemDoAviso = "producao" | "sandbox";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * O que a referência (`externalReference`) da cobrança diz sobre a academia:
 * `org:` e `b2b:` trazem a organização; `avulsa:` traz a linha da cobrança
 * avulsa; `metodo:` e `plano:` trazem o aluno. Referência de outro formato não
 * diz nada.
 */
export function pistaDaReferencia(
  referencia: string | null | undefined,
): { tipo: "organizacao" | "avulsa" | "aluno"; id: string } | null {
  const m = new RegExp(`^(org|b2b|avulsa|metodo|plano):(${UUID})$`, "i").exec(referencia ?? "");
  if (!m) return null;
  const prefixo = m[1].toLowerCase();
  const id = m[2].toLowerCase();
  if (prefixo === "org" || prefixo === "b2b") return { tipo: "organizacao", id };
  if (prefixo === "avulsa") return { tipo: "avulsa", id };
  return { tipo: "aluno", id };
}

/**
 * Trava de ambiente: aviso do sandbox só toca organização em homologação
 * (`trial`), e aviso de produção só toca organização real.
 *
 * Não é defesa contra colisão de id — é contenção de raio. O segredo do
 * sandbox é credencial de teste e vive mais exposta. `statusDasOrganizacoes`
 * traz o status de **toda** organização que o aviso alcança: pela assinatura,
 * pela referência e pela cobrança que já existe no banco com aquele id de
 * pagamento. Organização que o aviso aponta mas não existe entra como `null`.
 *
 * Até 06/10/2026 o aviso que não achava organização nenhuma passava: bastava
 * mandar, com o segredo do sandbox, o id de pagamento de uma cobrança de
 * produção sem assinatura nem referência. Agora o aviso do sandbox precisa
 * achar a organização, e todas as que ele alcança têm de estar em trial.
 */
export function ambienteDoAviso(
  origem: OrigemDoAviso,
  statusDasOrganizacoes: (string | null)[],
): { ok: true } | { ok: false; resultado: string } {
  const recusa = { ok: false as const, resultado: `ambiente_incompativel:${origem}` };
  if (origem === "sandbox") {
    if (statusDasOrganizacoes.length === 0) return recusa;
    return statusDasOrganizacoes.every((s) => s === "trial") ? { ok: true } : recusa;
  }
  // Produção que não acha organização nenhuma segue: termina como "sem
  // correspondência", que é o desfecho honesto.
  return statusDasOrganizacoes.some((s) => s === "trial") ? recusa : { ok: true };
}

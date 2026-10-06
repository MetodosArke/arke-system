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

/** Referência que a conta da academia pode trazer: a mensalidade e a avulsa do ARKE. */
const REFERENCIA_DA_ACADEMIA = new RegExp(`^(plano|avulsa):${UUID}$`, "i");

/** A referência é das que a conta da academia traz? O aviso que não é some antes de ser gravado. */
export function referenciaDaContaDaAcademia(referencia: string | null | undefined): boolean {
  return REFERENCIA_DA_ACADEMIA.test(referencia ?? "");
}

/**
 * O aviso que chega pelo webhook da conta da academia (`?org=<id>`, com o
 * token dela) só mexe em cobrança daquela academia que mora na conta dela.
 *
 * O token da academia vale menos que o da ArkeFit: ele mora no painel do
 * Asaas da academia, e a academia é parte interessada no que o aviso diz.
 * Por isso o aviso dela não alcança:
 *   * cobrança de outra academia (`organizacoes` tem de ser só ela);
 *   * o Método e a mensalidade B2B, que moram na conta da ArkeFit — um
 *     PAYMENT_CONFIRMED forjado não libera o Método nem quita a academia com
 *     a ArkeFit;
 *   * a mensalidade ou a avulsa que nasceu na conta da ArkeFit (antes de
 *     ligar o modo): `contasDasCobrancas` tem de ser toda "academia";
 *   * referência que não é do ARKE (a cobrança que a academia fez à mão na
 *     conta dela não é nossa, e nem é gravada).
 */
export function escopoDoAvisoDaAcademia(a: {
  orgDoToken: string;
  referencia: string | null | undefined;
  organizacoes: string[];
  tocaB2b: boolean;
  tocaMetodo: boolean;
  contasDasCobrancas: (string | null | undefined)[];
}): { ok: true } | { ok: false; resultado: string } {
  const fora = (motivo: string) => ({ ok: false as const, resultado: `fora_da_conta_da_academia:${motivo}` });
  if (!referenciaDaContaDaAcademia(a.referencia)) return fora("referencia");
  const org = a.orgDoToken.toLowerCase();
  if (a.organizacoes.length === 0 || a.organizacoes.some((o) => o.toLowerCase() !== org)) return fora("organizacao");
  if (a.tocaB2b) return fora("b2b");
  if (a.tocaMetodo) return fora("metodo");
  if (a.contasDasCobrancas.some((c) => c !== "academia")) return fora("conta");
  return { ok: true };
}

/** O id da academia no endereço do webhook (`?org=`), ou nulo. Formato fora de UUID é recusa, não "sem org". */
export function organizacaoDoEndereco(url: string): { org: string | null } | { invalido: true } {
  const bruto = new URL(url).searchParams.get("org");
  if (bruto === null || bruto === "") return { org: null };
  return new RegExp(`^${UUID}$`, "i").test(bruto) ? { org: bruto.toLowerCase() } : { invalido: true };
}

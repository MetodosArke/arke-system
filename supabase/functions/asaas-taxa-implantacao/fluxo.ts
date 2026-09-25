/**
 * Taxa de implantação: cobrança da ArkeFit à academia, à vista ou parcelada,
 * com valor e parcelamento de cada contrato. Sem Deno e sem Supabase, para
 * `npm run sandbox:implantacao` exercitar este código e não uma cópia.
 *
 * O que o sandbox decidiu (24/09/2026):
 *   * parcelamento aceita `billingType: UNDEFINED` — a academia escolhe PIX,
 *     boleto ou cartão em cada parcela, como na mensalidade B2B;
 *   * cada parcela herda a referência (`b2b:<organização>`) e ganha a
 *     descrição "Parcela i de N. …"; os vencimentos são mensais a partir do
 *     primeiro, e a última parcela absorve o arredondamento;
 *   * `GET /payments?installment=` lista as parcelas.
 */

export const DESCRICAO = "Taxa de implantação ARKE";
export const MAX_PARCELAS = 12;
export const VALOR_MINIMO_PARCELA = 5;

export type PedidoTaxa = { valor: number; parcelas: number; vencimento: string };

/** Valor digitado ("1.490,00", "1490", 1490) em número, ou NaN. */
export function lerValor(v: unknown): number {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/R\$/i, "").replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return /^\d{1,3}(\.\d{3})*,\d{0,2}$|^\d+,\d{0,2}$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : NaN;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

export function validarTaxa(
  corpo: { valor?: unknown; parcelas?: unknown; primeiro_vencimento?: unknown },
  hoje: string,
): { ok: true; pedido: PedidoTaxa } | { ok: false; erro: string } {
  const valor = lerValor(corpo.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Informe o valor da taxa." };
  if (Math.round(valor * 100) !== valor * 100) return { ok: false, erro: "O valor aceita no máximo duas casas decimais." };
  if (valor > 100_000) return { ok: false, erro: "Valor acima do permitido para a taxa de implantação." };
  const parcelas = Number(corpo.parcelas ?? 1);
  if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > MAX_PARCELAS) {
    return { ok: false, erro: `Parcelas: de 1 a ${MAX_PARCELAS}.` };
  }
  if (valor / parcelas < VALOR_MINIMO_PARCELA) {
    return { ok: false, erro: `Cada parcela precisa ser de pelo menos R$ ${VALOR_MINIMO_PARCELA},00 (mínimo do Asaas).` };
  }
  const vencimento = corpo.primeiro_vencimento ? String(corpo.primeiro_vencimento) : hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return { ok: false, erro: "Data do primeiro vencimento inválida." };
  if (vencimento < hoje) return { ok: false, erro: "O primeiro vencimento não pode ser no passado." };
  return { ok: true, pedido: { valor, parcelas, vencimento } };
}

export type ParcelaAsaas = {
  id: string;
  value: number;
  dueDate: string;
  description?: string;
  invoiceUrl?: string;
  installment?: string | null;
  installmentNumber?: number;
  deleted?: boolean;
  status?: string;
};

type Resposta<T> = { ok: boolean; status: number; corpo: T & { errors?: { description?: string }[] } };

/** Falha de rede ou tempo esgotado: o Asaas pode ter criado a cobrança. */
export class FalhaIndefinida extends Error {}

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  let resp: Response;
  try {
    resp = await fetch(`${api}${caminho}`, {
      method: metodo,
      headers: { access_token: chave, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new FalhaIndefinida(e instanceof Error ? e.name : "falha de rede");
  }
  let json: unknown = {};
  try {
    json = await resp.json();
  } catch {
    // corpo vazio
  }
  return { ok: resp.ok, status: resp.status, corpo: json as Resposta<T>["corpo"] };
}

const erroDoAsaas = (c: { errors?: { description?: string }[] }, padrao: string) =>
  c?.errors?.map((e) => e.description).filter(Boolean).join(" ") || padrao;

/** As parcelas de um parcelamento, em ordem. */
export async function parcelasDoParcelamento(api: string, chave: string, installmentId: string): Promise<ParcelaAsaas[]> {
  const r = await chamar<{ data?: ParcelaAsaas[] }>(api, chave, "GET", `/payments?installment=${encodeURIComponent(installmentId)}&limit=100`);
  if (!r.ok) throw new FalhaIndefinida(`parcelas responderam ${r.status}`);
  return (r.corpo.data ?? []).filter((p) => !p.deleted).sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
}

/**
 * Emite a taxa, ou adota a que já existe no Asaas para esta academia (mesma
 * referência e descrição): uma emissão cuja resposta se perdeu não vira duas
 * cobranças da implantação.
 */
export async function emitirOuAdotarTaxa(
  api: string,
  chave: string,
  p: { orgId: string; cliente: string; pedido: PedidoTaxa },
): Promise<
  | { ok: true; adotada: boolean; installmentId: string | null; parcelas: ParcelaAsaas[] }
  | { ok: false; erro: string; definitivo: boolean }
> {
  const referencia = `b2b:${p.orgId}`;
  try {
    const existentes = await chamar<{ data?: ParcelaAsaas[] }>(api, chave, "GET", `/payments?externalReference=${encodeURIComponent(referencia)}&limit=100`);
    if (!existentes.ok) return { ok: false, erro: "Não foi possível consultar o Asaas agora.", definitivo: false };
    const achada = (existentes.corpo.data ?? []).find((x) => !x.deleted && (x.description ?? "").includes(DESCRICAO));
    if (achada) {
      const parcelas = achada.installment ? await parcelasDoParcelamento(api, chave, achada.installment) : [achada];
      return { ok: true, adotada: true, installmentId: achada.installment ?? null, parcelas };
    }

    const corpo = {
      customer: p.cliente,
      billingType: "UNDEFINED",
      dueDate: p.pedido.vencimento,
      description: DESCRICAO,
      externalReference: referencia,
      ...(p.pedido.parcelas > 1 ? { installmentCount: p.pedido.parcelas, totalValue: p.pedido.valor } : { value: p.pedido.valor }),
    };
    const criada = await chamar<ParcelaAsaas>(api, chave, "POST", "/payments", corpo);
    if (!criada.ok) {
      return { ok: false, erro: erroDoAsaas(criada.corpo, "O Asaas recusou a cobrança."), definitivo: criada.status >= 400 && criada.status < 500 };
    }
    const parcelas = criada.corpo.installment ? await parcelasDoParcelamento(api, chave, criada.corpo.installment) : [criada.corpo];
    return { ok: true, adotada: false, installmentId: criada.corpo.installment ?? null, parcelas };
  } catch (e) {
    if (e instanceof FalhaIndefinida) return { ok: false, erro: "Não foi possível falar com o Asaas agora. Tente de novo em instantes.", definitivo: false };
    throw e;
  }
}

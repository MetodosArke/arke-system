/**
 * Conferência Asaas ↔ banco em lote. Sem Deno e sem Supabase, para os testes
 * exercitarem este código e não uma cópia — o mesmo critério dos outros
 * `fluxo.ts`.
 *
 * Até 24/09/2026 a varredura perguntava ao Asaas, uma de cada vez, pelas
 * cobranças de cada assinatura ativa. Com algumas centenas de milissegundos
 * por chamada e o limite de tempo de uma edge function, ela deixava de
 * conferir parte da base por volta de 1.000 assinaturas somando todas as
 * academias — e a consulta ao banco também parava em 1.000 linhas, sem aviso.
 * Hoje a pergunta vai ao contrário: o Asaas lista, de 100 em 100, o que
 * interessa (vencidas, criadas e recebidas nos últimos dias), e só o que
 * sobra sem resposta é consultado uma a uma.
 */

export type PagamentoAsaas = {
  id: string;
  status: string;
  deleted?: boolean;
  subscription?: string | null;
  externalReference?: string | null;
  value?: number;
  dueDate?: string;
  invoiceUrl?: string;
};

export type Origem = "metodo" | "plano" | "b2b" | "avulsa";

/** A tabela onde cada origem guarda a cobrança. */
export const TABELA: Record<Origem, "pagamentos" | "mensalidades" | "cobrancas_b2b" | "cobrancas_avulsas"> = {
  metodo: "pagamentos",
  plano: "mensalidades",
  b2b: "cobrancas_b2b",
  avulsa: "cobrancas_avulsas",
};

// Status do Asaas → evento que o asaas-webhook entende e o status que o banco
// deveria ter depois dele. Status fora da lista (análise de risco, reembolso
// em andamento...) não são reconciliados: são transitórios, e o webhook de
// desfecho resolve.
const MAPA: Record<string, { evento: string; statusBanco: string }> = {
  PENDING: { evento: "PAYMENT_CREATED", statusBanco: "pendente" },
  CONFIRMED: { evento: "PAYMENT_CONFIRMED", statusBanco: "confirmado" },
  RECEIVED: { evento: "PAYMENT_RECEIVED", statusBanco: "confirmado" },
  RECEIVED_IN_CASH: { evento: "PAYMENT_RECEIVED", statusBanco: "confirmado" },
  OVERDUE: { evento: "PAYMENT_OVERDUE", statusBanco: "atrasado" },
  REFUNDED: { evento: "PAYMENT_REFUNDED", statusBanco: "estornado" },
  CHARGEBACK_REQUESTED: { evento: "PAYMENT_CHARGEBACK_REQUESTED", statusBanco: "estornado" },
};

/** Estado que o banco deveria ter para este pagamento, ou nulo se não há o que reconciliar. */
export function esperado(p: PagamentoAsaas): { evento: string; statusBanco: string } | null {
  // Removida não é estorno: o webhook grava `cancelado` para PAYMENT_DELETED.
  if (p.deleted) return { evento: "PAYMENT_DELETED", statusBanco: "cancelado" };
  return MAPA[p.status] ?? null;
}

/**
 * A origem de uma cobrança pela referência que o ARKE põe nela (e que as
 * cobranças de uma assinatura herdam): `metodo:`, `plano:`, `b2b:`, `avulsa:`.
 * Referência de outro dono (cobrança feita à mão no painel do Asaas) não é
 * nossa, e não se reconcilia.
 */
export function origemDaReferencia(ref: string | null | undefined): Origem | null {
  const prefixo = (ref ?? "").split(":")[0];
  return prefixo === "metodo" || prefixo === "plano" || prefixo === "b2b" || prefixo === "avulsa" ? prefixo : null;
}

/**
 * O evento a reenviar ao webhook para o banco alcançar o Asaas, ou nulo.
 *
 * Cobrança pendente que o banco não tem conta como divergência — é o
 * PAYMENT_CREATED perdido, que deixaria a rede de segurança da inadimplência
 * sem o que pescar. Vale para as origens cuja emissão o webhook registra; a
 * avulsa nasce no banco antes de ir ao Asaas, então não tem esse caso.
 */
export function eventoParaCorrigir(p: PagamentoAsaas, statusLocal: string | null, origem: Origem): string | null {
  const alvo = esperado(p);
  if (!alvo) return null;
  if (alvo.statusBanco === "pendente") {
    return statusLocal === null && origem !== "avulsa" ? alvo.evento : null;
  }
  return statusLocal === alvo.statusBanco ? null : alvo.evento;
}

/**
 * Lança em vez de devolver nulo. Uma versão antiga devolvia nulo, e uma chave
 * inválida no Asaas virava "0 divergências, 0 órfãs, sem erro" — a falha
 * silenciosa que a conferência existe para acabar.
 */
export async function asaasGet<T>(api: string, chave: string, caminho: string): Promise<T> {
  const resp = await fetch(`${api}${caminho}`, { headers: { access_token: chave } });
  if (!resp.ok) throw new Error(`Asaas respondeu ${resp.status} em ${caminho.split("?")[0]}`);
  return (await resp.json()) as T;
}

/**
 * Todas as páginas de uma listagem do Asaas, de 100 em 100. `maxPaginas` é o
 * freio contra laço sem fim (um `hasMore` que nunca vira falso): passar dele
 * lança, para a varredura registrar que não terminou em vez de fingir que sim.
 */
export async function listarTodas<T>(api: string, chave: string, caminho: string, maxPaginas = 400): Promise<T[]> {
  const itens: T[] = [];
  const sep = caminho.includes("?") ? "&" : "?";
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const r = await asaasGet<{ data?: T[]; hasMore?: boolean }>(api, chave, `${caminho}${sep}limit=100&offset=${pagina * 100}`);
    itens.push(...(r.data ?? []));
    if (!r.hasMore) return itens;
  }
  throw new Error(`listagem ${caminho.split("?")[0]} passou de ${maxPaginas} páginas`);
}

/**
 * As listagens em lote que a varredura faz. `diasAtras(n)` = a data de
 * Brasília de n dias atrás, em `YYYY-MM-DD`.
 */
export function listagensDaVarredura(diasAtras: (n: number) => string): string[] {
  return [
    // Vencidas agora: pega o PAYMENT_OVERDUE perdido.
    "/payments?status=OVERDUE",
    // Criadas nos últimos dias: pega o PAYMENT_CREATED perdido.
    `/payments?dateCreated%5Bge%5D=${diasAtras(3)}`,
    // Recebidas nos últimos dias: pega o PAYMENT_RECEIVED perdido, inclusive
    // de quem pagou antes do vencimento.
    `/payments?paymentDate%5Bge%5D=${diasAtras(5)}`,
    // No cartão a confirmação vem antes do recebimento, e CONFIRMED ainda não
    // tem data de pagamento: lista-se pelo status.
    "/payments?status=CONFIRMED",
  ];
}

/** Divide uma lista em pedaços, para `.in()` não passar do tamanho de URL. */
export function emPedacos<T>(lista: T[], tamanho = 100): T[][] {
  const pedacos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) pedacos.push(lista.slice(i, i + tamanho));
  return pedacos;
}

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
export function origemDaReferencia(ref: string | null | undefined, origens: Origem[] = ["metodo", "plano", "b2b", "avulsa"]): Origem | null {
  const prefixo = (ref ?? "").split(":")[0];
  return (origens as string[]).includes(prefixo) ? (prefixo as Origem) : null;
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
 * O id do aviso que a conferência reenvia ao webhook. É o mesmo para a mesma
 * divergência, então reenviá-la de novo não repete o efeito, e é por ele que
 * a conferência lê o desfecho que o webhook gravou.
 */
export function idDoReenvio(p: PagamentoAsaas): string {
  return `reconciliacao:${p.id}:${p.deleted ? "DELETED" : p.status}`;
}

/**
 * Desfechos que o webhook grava quando o aviso mexeu na cobrança. Os outros
 * (`sem_correspondencia`, `evento_ignorado`, `sem_payment_id`,
 * `ambiente_incompativel:*`, `cartao_recusado`) não corrigem status nenhum.
 */
export const DESFECHOS_QUE_CORRIGEM = new Set([
  "cobranca_b2b_atualizada",
  "cobranca_b2b_criada",
  "cobranca_b2b_emitida",
  "avulsa_atualizada",
  "avulsa_emitida",
  "mensalidade_atualizada",
  "mensalidade_criada",
  "mensalidade_emitida",
  "pagamento_arke_atualizado",
  "pagamento_arke_criado",
  "pagamento_arke_emitido",
]);

export type EventoGravado = { processado: boolean | null; resultado: string | null; erro: string | null };

/**
 * O reenvio corrigiu a divergência? O webhook responde 200 também ao aviso
 * repetido, ao ignorado e ao que deu erro interno — por isso a resposta HTTP
 * não diz nada. Até 06/10/2026 a conferência contava como corrigido todo 200.
 *
 * Corrigiu quando as três coisas valem: o webhook gravou o aviso como
 * processado e sem erro; o desfecho é dos que mexem na cobrança; e o status
 * no banco, lido depois, é o que o Asaas diz. A última conta porque o banco
 * pode recusar a transição em silêncio (`trg_transicao_cobranca`: o que foi
 * pago não volta a dever), e o desfecho ainda diria "atualizada".
 *
 * `desfecho` explica, no registro da conferência, por que não corrigiu.
 */
export function correcaoAplicada(
  evento: EventoGravado | null,
  statusDepois: string | null,
  p: PagamentoAsaas,
): { corrigida: boolean; desfecho: string } {
  if (!evento) return { corrigida: false, desfecho: "aviso_nao_registrado" };
  if (evento.erro) return { corrigida: false, desfecho: "erro_no_webhook" };
  if (!evento.processado) return { corrigida: false, desfecho: "nao_processado" };
  const desfecho = evento.resultado ?? "sem_desfecho";
  if (!DESFECHOS_QUE_CORRIGEM.has(desfecho)) return { corrigida: false, desfecho };
  const alvo = esperado(p);
  if (!alvo || statusDepois !== alvo.statusBanco) return { corrigida: false, desfecho: `${desfecho}:status_${statusDepois ?? "ausente"}` };
  return { corrigida: true, desfecho };
}

/**
 * O valor no Asaas difere do valor no banco? Diferença de até um centavo é
 * arredondamento. Sem um dos dois, não há o que comparar.
 */
export function valorDiverge(asaas: number | undefined | null, banco: number | string | null | undefined): boolean {
  const b = typeof banco === "string" ? Number(banco) : banco;
  if (typeof asaas !== "number" || typeof b !== "number" || !Number.isFinite(asaas) || !Number.isFinite(b)) return false;
  return Math.abs(asaas - b) > 0.01;
}

/**
 * Lança em vez de devolver nulo. Uma versão antiga devolvia nulo, e uma chave
 * inválida no Asaas virava "0 divergências, 0 órfãs, sem erro" — a falha
 * silenciosa que a conferência existe para acabar.
 */
export async function asaasGet<T>(api: string, chave: string, caminho: string): Promise<T> {
  const resp = await fetch(`${api}${caminho}`, { signal: AbortSignal.timeout(20_000), headers: { access_token: chave } });
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

/**
 * As contas que a varredura confere. A da ArkeFit tem as quatro origens; a
 * conta de uma academia com a cobrança na conta dela
 * (`organizations.cobranca_conta_academia`) tem só a mensalidade e a avulsa
 * — o Método e o B2B moram sempre na conta da ArkeFit.
 */
export type ContaDaVarredura = { nome: "arkefit" } | { nome: "academia"; organizationId: string };

export function origensDaConta(conta: ContaDaVarredura): Origem[] {
  return conta.nome === "arkefit" ? ["metodo", "plano", "b2b", "avulsa"] : ["plano", "avulsa"];
}

/**
 * Em qual conta mora a cobrança do banco. O Método e o B2B, sempre na da
 * ArkeFit; a mensalidade, onde a matrícula dela nasceu; a avulsa, onde ela
 * nasceu (`conta_asaas`). Perguntar à conta errada por uma cobrança devolve
 * "não encontrada" — a falha falsa que a varredura não pode inventar.
 */
export function contaDaCobrancaNoBanco(origem: Origem, contaGravada: string | null | undefined): "arkefit" | "academia" {
  if (origem === "metodo" || origem === "b2b") return "arkefit";
  return contaGravada === "academia" ? "academia" : "arkefit";
}

/** A cobrança do banco é desta conta? Na da academia, também tem de ser daquela academia. */
export function cobrancaDaConta(
  conta: ContaDaVarredura,
  origem: Origem,
  linha: { conta_asaas?: string | null; organization_id?: string | null },
): boolean {
  const onde = contaDaCobrancaNoBanco(origem, linha.conta_asaas);
  if (conta.nome === "arkefit") return onde === "arkefit";
  return onde === "academia" && linha.organization_id === conta.organizationId;
}

/** Divide uma lista em pedaços, para `.in()` não passar do tamanho de URL. */
export function emPedacos<T>(lista: T[], tamanho = 100): T[][] {
  const pedacos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) pedacos.push(lista.slice(i, i + tamanho));
  return pedacos;
}

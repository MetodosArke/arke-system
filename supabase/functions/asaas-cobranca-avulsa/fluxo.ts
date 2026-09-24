/**
 * Cobrança avulsa no Asaas: validar, emitir sem duplicar e cancelar.
 *
 * Sem Deno e sem Supabase de propósito, para `npm run sandbox:avulsa`
 * exercitar este código e não uma cópia dele — o mesmo critério do `fluxo.ts`
 * do cartão, do ciclo de assinatura e da conta da academia.
 *
 * A emissão é idempotente pelo `externalReference` (`avulsa:<id da linha>`):
 * antes de criar, pergunta ao Asaas se a cobrança daquela linha já existe. É
 * o que torna seguro repetir uma emissão cuja resposta se perdeu — sem isso,
 * "tentar de novo" mandaria ao aluno duas faturas da mesma taxa.
 */

export const TIPOS_COBRANCA_AVULSA = [
  "taxa_matricula",
  "avaliacao_fisica",
  "personal",
  "diaria",
  "produto",
  "outro",
] as const;
export type TipoCobrancaAvulsa = (typeof TIPOS_COBRANCA_AVULSA)[number];

/** Descrição sugerida quando a equipe não escreve outra. */
export const DESCRICAO_PADRAO: Record<TipoCobrancaAvulsa, string> = {
  taxa_matricula: "Taxa de matrícula",
  avaliacao_fisica: "Avaliação física",
  personal: "Aula com personal",
  diaria: "Diária",
  produto: "Produto",
  outro: "Cobrança avulsa",
};

/**
 * O Asaas recusa cobrança abaixo de R$ 5,00 quando o aluno escolhe a forma de
 * pagamento na fatura (visto no sandbox em 24/09/2026). Dizer antes poupa uma
 * ida ao gateway e uma linha para desfazer.
 */
export const VALOR_MINIMO = 5;
/**
 * Teto de sanidade, não regra de negócio: pega o "12000" digitado no lugar de
 * "120,00" antes que vire fatura na caixa do aluno.
 */
export const VALOR_MAXIMO = 10_000;
/** Vencimento no máximo um ano à frente: além disso é quase certo engano. */
export const DIAS_MAXIMOS_VENCIMENTO = 365;

export type PedidoCobranca = {
  tipo: TipoCobrancaAvulsa;
  descricao: string;
  valor: number;
  vencimento: string;
};

/** Soma dias a uma data AAAA-MM-DD sem passar por fuso nenhum. */
function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + dias));
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${r.getUTCFullYear()}-${dois(r.getUTCMonth() + 1)}-${dois(r.getUTCDate())}`;
}

/**
 * Confere e normaliza o pedido. `hoje` é a data de Brasília (injetada, para
 * ser testável): o Asaas recusa vencimento no passado, e dizer isso antes
 * poupa uma ida ao gateway e uma linha para desfazer.
 */
export function validarCobrancaAvulsa(
  entrada: { tipo?: unknown; descricao?: unknown; valor?: unknown; vencimento?: unknown },
  hoje: string,
): { ok: true; pedido: PedidoCobranca } | { ok: false; erro: string } {
  const tipo = String(entrada.tipo ?? "") as TipoCobrancaAvulsa;
  if (!TIPOS_COBRANCA_AVULSA.includes(tipo)) return { ok: false, erro: "Tipo de cobrança inválido." };

  const descricao = String(entrada.descricao ?? "").trim() || DESCRICAO_PADRAO[tipo];
  if (descricao.length < 3 || descricao.length > 120) {
    return { ok: false, erro: "A descrição precisa ter entre 3 e 120 caracteres." };
  }

  const valor = typeof entrada.valor === "number" ? entrada.valor : Number(String(entrada.valor ?? "").replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  if (valor < VALOR_MINIMO) return { ok: false, erro: "O Asaas só emite cobrança a partir de R$ 5,00." };
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) {
    return { ok: false, erro: "O valor aceita no máximo duas casas decimais." };
  }
  if (valor > VALOR_MAXIMO) {
    return { ok: false, erro: `Valor acima de R$ ${VALOR_MAXIMO.toLocaleString("pt-BR")} — confira se não sobrou um zero.` };
  }

  const vencimento = entrada.vencimento ? String(entrada.vencimento) : hoje;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento) || Number.isNaN(Date.parse(`${vencimento}T12:00:00Z`))) {
    return { ok: false, erro: "Data de vencimento inválida." };
  }
  if (vencimento < hoje) return { ok: false, erro: "O vencimento não pode ser no passado." };
  if (vencimento > somarDias(hoje, DIAS_MAXIMOS_VENCIMENTO)) {
    return { ok: false, erro: "O vencimento pode ser no máximo daqui a um ano." };
  }

  return { ok: true, pedido: { tipo, descricao, valor: Math.round(valor * 100) / 100, vencimento } };
}

// --- Asaas --------------------------------------------------------------------

type Resposta<T> = { ok: boolean; status: number; corpo: T & { errors?: { code?: string; description?: string }[] } };

/** Falha de rede ou tempo esgotado: o Asaas pode ter criado a cobrança. */
class FalhaIndefinida extends Error {}

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  let resp: Response;
  try {
    resp = await fetch(`${api}${caminho}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", access_token: chave },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new FalhaIndefinida(e instanceof Error ? e.name : "falha de rede");
  }
  let json: unknown = {};
  try {
    json = await resp.json();
  } catch {
    // corpo vazio ou não-JSON: fica {}.
  }
  return { ok: resp.ok, status: resp.status, corpo: json as Resposta<T>["corpo"] };
}

function descricaoErro(corpo: { errors?: { description?: string }[] }): string | null {
  return corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;
}

/**
 * Reaproveita o customer do aluno: primeiro pelo id do aluno, depois pelo CPF.
 * Mesma regra da matrícula e do Método — para o Asaas, a mesma pessoa é um
 * cliente só. CPF em branco é recusado aqui porque `?cpfCnpj=` vazio não
 * filtra: devolveria a lista inteira e a cobrança nasceria em outra pessoa.
 */
export async function obterOuCriarCustomer(
  api: string,
  chave: string,
  dados: { alunoId: string; nome: string; cpf: string; telefone: string | null },
): Promise<{ id: string } | { erro: string }> {
  if (dados.cpf.length !== 11 || !dados.alunoId) {
    return { erro: "CPF do aluno ausente ou inválido: o Asaas exige CPF para emitir a cobrança." };
  }
  for (const filtro of [`externalReference=${encodeURIComponent(dados.alunoId)}`, `cpfCnpj=${dados.cpf}`]) {
    const busca = await chamar<{ data?: { id: string; deleted?: boolean }[] }>(api, chave, "GET", `/customers?${filtro}`);
    const existente = busca.ok ? busca.corpo.data?.find((c) => !c.deleted) : undefined;
    if (existente) return { id: existente.id };
  }
  const criado = await chamar<{ id: string }>(api, chave, "POST", "/customers", {
    name: dados.nome,
    cpfCnpj: dados.cpf,
    mobilePhone: dados.telefone ?? undefined,
    externalReference: dados.alunoId,
  });
  if (!criado.ok) return { erro: descricaoErro(criado.corpo) ?? "Falha ao criar o cliente no Asaas." };
  return { id: criado.corpo.id };
}

export type CobrancaAsaas = {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl?: string;
  deleted?: boolean;
  split?: { walletId: string; fixedValue?: number; status?: string }[];
};

/** A cobrança desta linha no Asaas, se já existir (a não removida). */
export async function cobrancaPorReferencia(api: string, chave: string, referencia: string): Promise<CobrancaAsaas | null> {
  const busca = await chamar<{ data?: CobrancaAsaas[] }>(
    api,
    chave,
    "GET",
    `/payments?externalReference=${encodeURIComponent(referencia)}`,
  );
  if (!busca.ok) throw new FalhaIndefinida(`consulta respondeu ${busca.status}`);
  return busca.corpo.data?.find((p) => !p.deleted) ?? null;
}

export type ResultadoEmissao =
  | { ok: true; cobranca: CobrancaAsaas; adotada: boolean }
  /**
   * `definitivo`: o Asaas recusou e nada foi criado — a linha pode ser
   * desfeita. Indefinido (rede, tempo, 5xx): a cobrança pode existir lá, e a
   * linha fica para "tentar de novo", que a adota em vez de duplicar.
   */
  | { ok: false; erro: string; definitivo: boolean };

export async function emitirCobrancaAvulsa(
  api: string,
  chave: string,
  dados: {
    referencia: string;
    aluno: { alunoId: string; nome: string; cpf: string; telefone: string | null };
    valor: number;
    vencimento: string;
    descricao: string;
    walletAcademia: string;
    valorLiquidoAcademia: number;
  },
): Promise<ResultadoEmissao> {
  try {
    const existente = await cobrancaPorReferencia(api, chave, dados.referencia);
    if (existente) return { ok: true, cobranca: existente, adotada: true };

    const customer = await obterOuCriarCustomer(api, chave, dados.aluno);
    if ("erro" in customer) return { ok: false, erro: customer.erro, definitivo: true };

    const criada = await chamar<CobrancaAsaas>(api, chave, "POST", "/payments", {
      customer: customer.id,
      // O aluno escolhe PIX, boleto ou cartão na página da fatura.
      billingType: "UNDEFINED",
      value: dados.valor,
      dueDate: dados.vencimento,
      description: dados.descricao,
      externalReference: dados.referencia,
      // A academia recebe o valor menos a taxa de processamento; a taxa do
      // Asaas sai do que sobra na conta da ArkeFit — o mesmo split da
      // mensalidade.
      split: [{ walletId: dados.walletAcademia, fixedValue: dados.valorLiquidoAcademia }],
    });
    if (criada.ok) return { ok: true, cobranca: criada.corpo, adotada: false };
    const erro = descricaoErro(criada.corpo) ?? `O Asaas recusou a cobrança (HTTP ${criada.status}).`;
    return { ok: false, erro, definitivo: criada.status >= 400 && criada.status < 500 };
  } catch (e) {
    if (e instanceof FalhaIndefinida) {
      return { ok: false, erro: "Não foi possível confirmar a emissão com o Asaas.", definitivo: false };
    }
    throw e;
  }
}

export type ResultadoCancelamento =
  | { ok: true; jaNaoExistia: boolean }
  | { ok: false; erro: string; paga?: boolean };

/**
 * Remove a cobrança no Asaas. Cobrança já removida (404 ou `deleted`) conta
 * como sucesso — cancelar duas vezes não é erro. Cobrança já paga o Asaas não
 * remove, e aí a resposta diz isso em vez de fingir que cancelou.
 */
export async function cancelarCobranca(api: string, chave: string, paymentId: string): Promise<ResultadoCancelamento> {
  try {
    const r = await chamar<{ deleted?: boolean }>(api, chave, "DELETE", `/payments/${encodeURIComponent(paymentId)}`);
    if (r.ok) return { ok: true, jaNaoExistia: false };
    if (r.status === 404) return { ok: true, jaNaoExistia: true };
    const atual = await chamar<CobrancaAsaas>(api, chave, "GET", `/payments/${encodeURIComponent(paymentId)}`);
    if (atual.ok && atual.corpo.deleted) return { ok: true, jaNaoExistia: true };
    if (atual.ok && ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(atual.corpo.status)) {
      return { ok: false, erro: "Esta cobrança já foi paga — não dá mais para cancelar. Se precisar devolver, faça o estorno no Asaas.", paga: true };
    }
    return { ok: false, erro: descricaoErro(r.corpo) ?? `O Asaas não cancelou a cobrança (HTTP ${r.status}).` };
  } catch (e) {
    if (e instanceof FalhaIndefinida) return { ok: false, erro: "Não foi possível falar com o Asaas agora. Tente de novo em instantes." };
    throw e;
  }
}

import { hojeBrasilia } from "../_shared/data.ts";
// Chamadas ao Asaas da assinatura do Método ARKE, separadas do index.ts.
//
// Por que separado: aqui não há Deno nem Supabase, só `fetch`. É o que permite
// `npm run sandbox:assinatura` exercitar **este** código contra o sandbox do
// Asaas, e não uma cópia escrita para o teste — que é o defeito clássico de
// teste de integração com gateway: a cópia diverge do original e o teste passa
// enquanto a produção quebra. Mesmo formato já usado em
// `asaas-cartao-assinatura/fluxo.ts` e `asaas-conta-academia/fluxo.ts`.
//
// As decisões de negócio — adesão ao Método, onboarding da academia, CPF,
// valor mínimo — ficam no index.ts, antes de qualquer chamada daqui. O que
// mora neste arquivo é só a conversa com o gateway.

export type RespostaAsaas<T> = {
  ok: boolean;
  status: number;
  corpo: T & { errors?: { code?: string; description?: string }[] };
};

export async function chamarAsaas<T>(url: string, init: RequestInit): Promise<RespostaAsaas<T>> {
  const resp = await fetch(url, init);
  let corpo: unknown = {};
  try {
    corpo = await resp.json();
  } catch {
    // corpo vazio ou não-JSON: fica {}.
  }
  return { ok: resp.ok, status: resp.status, corpo: corpo as RespostaAsaas<T>["corpo"] };
}

export function descricaoErroAsaas(corpo: { errors?: { description?: string }[] }): string | null {
  return corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;
}

export function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

/**
 * Hoje no fuso de Brasília. Em UTC, depois das 21h a data já é a de amanhã, e
 * a primeira cobrança venceria um dia depois da matrícula.
 */
export const hojeEmBrasilia = hojeBrasilia;

/**
 * Reaproveita o customer do aluno antes de criar outro: primeiro pelo id do
 * aluno (`externalReference`), depois pelo CPF — a mesma pessoa pode ser aluna
 * de duas academias, e para o Asaas ela é um cliente só.
 */
export async function obterOuCriarCustomer(
  api: string,
  headers: Record<string, string>,
  dados: { alunoId: string; nome: string; cpf: string; telefone: string | null },
): Promise<{ id: string } | { erro: string }> {
  // Filtro vazio no Asaas não filtra: `GET /customers?cpfCnpj=` devolve a
  // lista inteira da conta. Como a busca abaixo adota o primeiro resultado,
  // um CPF em branco faria a assinatura do aluno nascer grudada no customer
  // de **outra pessoa** — cobrando quem não devia.
  //
  // Os chamadores já exigem CPF antes de chegar aqui, mas essa é uma garantia
  // que depende de quem chama lembrar. Verificado no sandbox em 22/09/2026:
  // com o filtro vazio, o Asaas devolveu os 6 clientes da conta.
  if (dados.cpf.length !== 11 || !dados.alunoId) {
    return { erro: "CPF do aluno ausente ou inválido: o Asaas exige CPF para emitir a assinatura." };
  }

  for (const filtro of [`externalReference=${encodeURIComponent(dados.alunoId)}`, `cpfCnpj=${dados.cpf}`]) {
    const busca = await chamarAsaas<{ data?: { id: string; deleted?: boolean }[] }>(
      `${api}/customers?${filtro}`,
      { headers },
    );
    const existente = busca.ok ? busca.corpo.data?.find((c) => !c.deleted) : undefined;
    if (existente) return { id: existente.id };
  }

  const criado = await chamarAsaas<{ id: string }>(`${api}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: dados.nome,
      cpfCnpj: dados.cpf,
      mobilePhone: dados.telefone ?? undefined,
      externalReference: dados.alunoId,
    }),
  });
  if (!criado.ok) {
    // Sem o corpo no log: ele carrega nome e CPF do aluno.
    console.error("Asaas: falha ao criar customer", criado.status, criado.corpo?.errors);
    return { erro: descricaoErroAsaas(criado.corpo) ?? "Falha ao criar o cliente no Asaas." };
  }
  return { id: criado.corpo.id };
}

export type AssinaturaAsaas = {
  id: string;
  value: number;
  nextDueDate?: string;
  split?: { fixedValue?: number | null }[];
};

/** Assinatura ativa com esta referência no Asaas, se houver. */
export async function assinaturaAtivaNoAsaas(
  api: string,
  headers: Record<string, string>,
  referencia: string,
): Promise<AssinaturaAsaas | null> {
  const busca = await chamarAsaas<{ data?: AssinaturaAsaas[] }>(
    `${api}/subscriptions?externalReference=${encodeURIComponent(referencia)}&status=ACTIVE`,
    { headers },
  );
  return busca.ok ? busca.corpo.data?.[0] ?? null : null;
}

/**
 * Parte da ArkeFit numa assinatura já existente no Asaas: o valor menos o split
 * da academia. Sem split na resposta, nula — quem chama usa o calculado, em vez
 * de contar o valor inteiro como repasse.
 */
export function repasseDoSplit(assinatura: AssinaturaAsaas): number | null {
  if (!assinatura.split?.length) return null;
  const academia = (assinatura.split ?? []).reduce((soma, s) => soma + Number(s.fixedValue ?? 0), 0);
  return Math.round((Number(assinatura.value) - academia) * 100) / 100;
}

/**
 * Cria a assinatura do Método no Asaas — ou adota a que já estiver lá.
 *
 * A idempotência é pelo `externalReference` `metodo:<aluno>`. O caso que ela
 * resolve é o mais caro: criou no Asaas, falhou ao gravar no banco, a tela
 * segue oferecendo "Tentar cobrar" — e a primeira assinatura fica órfã,
 * cobrando o aluno todo mês sem ninguém ver.
 *
 * O split é `fixedValue` para a academia; o que sobra é da ArkeFit, e é de lá
 * que o Asaas desconta a taxa. Por isso o repasse já inclui a taxa de
 * processamento, calculada pelo chamador.
 */
export async function criarOuAdotarAssinatura(
  api: string,
  headers: Record<string, string>,
  dados: {
    customerId: string;
    referencia: string;
    valorCobrado: number;
    primeiroVencimento: string;
    descricao: string;
    walletIdAcademia: string;
    valorLiquidoAcademia: number;
  },
): Promise<{ assinatura: AssinaturaAsaas; adotada: boolean } | { erro: string }> {
  const jaExistente = await assinaturaAtivaNoAsaas(api, headers, dados.referencia);
  if (jaExistente) return { assinatura: jaExistente, adotada: true };

  const criada = await chamarAsaas<AssinaturaAsaas>(`${api}/subscriptions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer: dados.customerId,
      billingType: "UNDEFINED",
      value: dados.valorCobrado,
      cycle: "MONTHLY",
      nextDueDate: dados.primeiroVencimento,
      description: dados.descricao,
      externalReference: dados.referencia,
      split: [{ walletId: dados.walletIdAcademia, fixedValue: dados.valorLiquidoAcademia }],
    }),
  });
  if (!criada.ok) {
    console.error("Asaas: falha ao criar assinatura", criada.status, criada.corpo?.errors);
    return { erro: descricaoErroAsaas(criada.corpo) ?? "Falha ao criar assinatura no Asaas." };
  }
  return { assinatura: criada.corpo, adotada: false };
}

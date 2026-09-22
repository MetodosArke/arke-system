// Mensalidade B2B recorrente: a assinatura no Asaas da academia com a ArkeFit.
//
// Antes cada mensalidade era emitida à mão na Visão Master
// (asaas-emitir-cobranca-b2b, cobrança avulsa); esquecer uma academia
// significava uso sem pagamento e um bloqueio por inadimplência que nunca
// disparava. A assinatura nasce quando a academia conclui o onboarding.
//
// Sem Deno nem Supabase, para ser exercitada contra o sandbox
// (scripts/asaas-sandbox-conta.mjs).
//
// Idempotente pelos dois lados, na convenção dos prefixos: o customer é
// procurado por `org:<id>` e depois pelo CNPJ; a assinatura por `b2b:<id>`
// ativa. Criou no Asaas e falhou ao gravar no banco → a próxima tentativa
// adota, não duplica. As cobranças geradas herdam o `externalReference` da
// assinatura, o mesmo `b2b:<id>` das cobranças avulsas.

type ErrosAsaas = { errors?: { code?: string; description?: string }[] };

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown) {
  const resp = await fetch(api + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", access_token: chave, "User-Agent": "arke" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let json = {} as T & ErrosAsaas;
  try {
    json = await resp.json();
  } catch {
    // sem corpo JSON
  }
  return { ok: resp.ok, status: resp.status, corpo: json };
}

function mensagem(corpo: ErrosAsaas, padrao: string) {
  const d = corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ");
  return d ? `Asaas: ${d}` : padrao;
}

/** Data de hoje em Brasília — a mensalidade B2B vale desde o primeiro dia. */
export function hojeBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type DadosClienteB2b = { orgId: string; nome: string; cpfCnpj: string; email: string; telefone: string };

export async function garantirClienteB2b(
  api: string,
  chave: string,
  c: DadosClienteB2b
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  for (const filtro of [`externalReference=${encodeURIComponent(`org:${c.orgId}`)}`, `cpfCnpj=${c.cpfCnpj}`]) {
    const busca = await chamar<{ data?: { id: string; deleted?: boolean }[] }>(api, chave, "GET", `/customers?${filtro}`);
    if (!busca.ok) return { ok: false, erro: mensagem(busca.corpo, "Não foi possível consultar o Asaas agora.") };
    const achado = busca.corpo.data?.find((x) => !x.deleted);
    if (achado) return { ok: true, id: achado.id };
  }
  const criado = await chamar<{ id?: string }>(api, chave, "POST", "/customers", {
    name: c.nome,
    cpfCnpj: c.cpfCnpj,
    email: c.email,
    mobilePhone: c.telefone,
    externalReference: `org:${c.orgId}`,
  });
  if (!criado.ok || !criado.corpo.id) return { ok: false, erro: mensagem(criado.corpo, "O Asaas não criou o cliente.") };
  return { ok: true, id: criado.corpo.id };
}

export type ResultadoAssinaturaB2b =
  | { ok: true; id: string; adotada: boolean; valor: number }
  | { ok: false; erro: string };

export async function criarOuAdotarAssinaturaB2b(
  api: string,
  chave: string,
  a: { orgId: string; customer: string; valor: number; descricao: string; primeiroVencimento: string }
): Promise<ResultadoAssinaturaB2b> {
  const ref = `b2b:${a.orgId}`;
  const busca = await chamar<{ data?: { id: string; value: number; status: string }[] }>(
    api,
    chave,
    "GET",
    `/subscriptions?externalReference=${encodeURIComponent(ref)}&status=ACTIVE`
  );
  if (!busca.ok) return { ok: false, erro: mensagem(busca.corpo, "Não foi possível consultar o Asaas agora.") };
  const ativa = busca.corpo.data?.[0];
  if (ativa) return { ok: true, id: ativa.id, adotada: true, valor: Number(ativa.value) };

  const criada = await chamar<{ id?: string }>(api, chave, "POST", "/subscriptions", {
    customer: a.customer,
    // A academia escolhe na fatura: PIX, boleto ou cartão.
    billingType: "UNDEFINED",
    value: a.valor,
    nextDueDate: a.primeiroVencimento,
    cycle: "MONTHLY",
    description: a.descricao,
    externalReference: ref,
  });
  if (!criada.ok || !criada.corpo.id) return { ok: false, erro: mensagem(criada.corpo, "O Asaas não criou a assinatura.") };
  return { ok: true, id: criada.corpo.id, adotada: false, valor: a.valor };
}

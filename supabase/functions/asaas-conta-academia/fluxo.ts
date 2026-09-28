// Chamadas ao Asaas da conta da academia (onboarding → Recebimentos).
//
// Separadas do index.ts, sem Deno nem Supabase, para serem exercitadas tal
// como estão contra o sandbox (scripts/asaas-sandbox-conta.mjs), no mesmo
// padrão do fluxo do cartão.
//
// ## O que o Asaas faz e o que fica com a academia
//
// Subconta no modelo padrão (sem BaaS contratado com o gerente do Asaas): o
// ARKE cria com POST /accounts e recebe `walletId`, `id` e a `apiKey`. A
// academia recebe um e-mail do Asaas, define a senha e, na interface do
// próprio Asaas, envia os documentos e cadastra a conta bancária para saque.
// O ARKE não coleta dado bancário nem documento — nada disso passa por aqui.
//
// A `apiKey` da subconta vem **uma única vez**, na criação, e o Asaas não deixa
// a conta-mãe gerar outra depois. É o único jeito de consultar a situação
// cadastral (GET /myAccount/status), por isso vai para o Vault.
//
// ## Idempotência
//
// Criou no Asaas e falhou ao gravar no banco: a próxima tentativa acha a
// subconta pelo CNPJ (GET /accounts?cpfCnpj=) e a adota, em vez de abrir outra.
// A adotada não tem chave — a situação passa a ser acompanhada no Asaas.

type ErrosAsaas = { errors?: { code?: string; description?: string }[] };
type RespostaAsaas<T> = { ok: boolean; status: number; corpo: T & ErrosAsaas };

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<RespostaAsaas<T>> {
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

export function mensagemAsaas(corpo: ErrosAsaas, padrao: string): string {
  const d = corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ");
  return d ? `Asaas: ${d}` : padrao;
}

const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export type OrganizacaoParaSubconta = {
  nome: string;
  razao_social: string | null;
  cnpj_cpf: string | null;
  email_contato: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  tipo_empresa: string | null;
  faturamento_mensal: number | null;
  /** Só para CPF: o Asaas exige a data de nascimento de quem abre conta de pessoa física. */
  responsavel_nascimento?: string | null;
};

export type PayloadSubconta = Record<string, string | number>;

/**
 * Monta o corpo de POST /accounts a partir do cadastro da academia, ou diz o
 * que falta. Com CNPJ, vão a razão social e o tipo de empresa. Com CPF (o
 * profissional autônomo que não tem CNPJ), vão o nome completo — guardado em
 * `razao_social` — e a data de nascimento, que o Asaas exige para pessoa
 * física; tipo de empresa não se aplica.
 */
export function montarSubconta(o: OrganizacaoParaSubconta): { ok: true; payload: PayloadSubconta } | { ok: false; faltando: string[] } {
  const faltando: string[] = [];
  const doc = soDigitos(o.cnpj_cpf);
  const pessoaFisica = doc.length === 11;
  if (doc.length !== 14 && !pessoaFisica) faltando.push("CNPJ ou CPF");
  if (!o.razao_social?.trim()) faltando.push(pessoaFisica ? "nome completo" : "razão social");
  if (!o.email_contato?.trim()) faltando.push("e-mail");
  const celular = soDigitos(o.telefone);
  if (celular.length < 10) faltando.push("celular");
  if (soDigitos(o.cep).length !== 8) faltando.push("CEP");
  if (!o.logradouro?.trim() || !o.numero?.trim() || !o.bairro?.trim()) faltando.push("endereço");
  if (!pessoaFisica && !o.tipo_empresa) faltando.push("tipo de empresa");
  if (pessoaFisica && !/^\d{4}-\d{2}-\d{2}$/.test(o.responsavel_nascimento ?? "")) faltando.push("data de nascimento");
  if (!o.faturamento_mensal || o.faturamento_mensal <= 0) faltando.push("faturamento mensal");
  if (faltando.length) return { ok: false, faltando };

  const payload: PayloadSubconta = {
    name: o.razao_social!.trim(),
    email: o.email_contato!.trim().toLowerCase(),
    cpfCnpj: doc,
    ...(pessoaFisica ? { birthDate: o.responsavel_nascimento! } : { companyType: o.tipo_empresa! }),
    mobilePhone: celular,
    incomeValue: Number(o.faturamento_mensal),
    address: o.logradouro!.trim(),
    addressNumber: o.numero!.trim(),
    province: o.bairro!.trim(),
    postalCode: soDigitos(o.cep),
  };
  if (o.complemento?.trim()) payload.complement = o.complemento.trim();
  return { ok: true, payload };
}

export type ResultadoSubconta =
  | { ok: true; id: string; walletId: string; apiKey: string | null; adotada: boolean }
  | { ok: false; status: number; erro: string };

export async function criarOuAdotarSubconta(api: string, chave: string, payload: PayloadSubconta): Promise<ResultadoSubconta> {
  const busca = await chamar<{ data?: { id: string; walletId: string }[] }>(
    api,
    chave,
    "GET",
    `/accounts?cpfCnpj=${encodeURIComponent(String(payload.cpfCnpj))}`
  );
  if (!busca.ok) {
    console.error("Asaas: falha ao buscar subconta", busca.status, busca.corpo?.errors?.map((e) => e.code) ?? []);
    return { ok: false, status: 502, erro: mensagemAsaas(busca.corpo, "Não foi possível consultar o Asaas agora. Tente de novo.") };
  }
  const existente = busca.corpo.data?.[0];
  if (existente?.walletId) {
    return { ok: true, id: existente.id, walletId: existente.walletId, apiKey: null, adotada: true };
  }

  const criada = await chamar<{ id?: string; walletId?: string; apiKey?: string }>(api, chave, "POST", "/accounts", payload);
  if (!criada.ok || !criada.corpo.walletId || !criada.corpo.id) {
    console.error("Asaas: falha ao criar subconta", criada.status, criada.corpo?.errors?.map((e) => e.code) ?? []);
    return { ok: false, status: criada.status === 400 ? 400 : 502, erro: mensagemAsaas(criada.corpo, "O Asaas não criou a conta. Tente de novo.") };
  }
  return { ok: true, id: criada.corpo.id, walletId: criada.corpo.walletId, apiKey: criada.corpo.apiKey ?? null, adotada: false };
}

export type SituacaoConta = { general: string; commercialInfo?: string; bankAccountInfo?: string; documentation?: string };

/** Situação cadastral — com a chave da **subconta**, não a da ArkeFit. */
export async function consultarSituacao(api: string, chaveSubconta: string): Promise<{ ok: true; situacao: SituacaoConta } | { ok: false; erro: string }> {
  const r = await chamar<SituacaoConta>(api, chaveSubconta, "GET", "/myAccount/status");
  if (!r.ok || !r.corpo.general) {
    console.error("Asaas: falha ao consultar situação", r.status, r.corpo?.errors?.map((e) => e.code) ?? []);
    return { ok: false, erro: mensagemAsaas(r.corpo, "Não foi possível consultar a situação da conta no Asaas.") };
  }
  return { ok: true, situacao: r.corpo };
}

/** Carteiras da própria conta (a da ArkeFit): split para ela é recusado pelo Asaas. */
export async function carteirasProprias(api: string, chave: string): Promise<string[] | null> {
  const r = await chamar<{ data?: { id: string }[] }>(api, chave, "GET", "/wallets");
  if (!r.ok) return null;
  return (r.corpo.data ?? []).map((w) => w.id);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function walletIdValido(valor: string): boolean {
  return UUID_RE.test(valor.trim());
}

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

// ## Subconta aberta pela ArkeFit é BaaS (06/10/2026)
//
// O Asaas respondeu que abrir a conta da academia pela conta da ArkeFit é
// BaaS, com homologação, e o BaaS segue a Resolução Conjunta BCB/CMN nº
// 16/2025: o Asaas aparece identificado como prestador, e a conta é do
// cliente final, na instituição prestadora. Por isso o caminho fica atrás do
// interruptor `asaas_subcontas_baas` (`plataforma_config`, 0 por padrão) e,
// ligado, só abre depois do aceite dos Termos de Uso do Asaas pela gestão da
// academia — os Termos do Asaas (5.1.3) pedem que a subconta esteja ciente
// deles e concorde.

/**
 * Os Termos de Uso do Asaas, no endereço que o próprio site do Asaas liga no
 * rodapé ("Termos de uso"). Conferido em 06/10/2026. Espelho de
 * `src/lib/prestadorPagamentos.ts`; `subcontaBaas.guarda.test.ts` cobra os dois iguais.
 */
export const TERMOS_ASAAS_URL =
  "https://central.ajuda.asaas.com/hc/pt-br/articles/32096847160859-Termos-e-Condi%C3%A7%C3%B5es-de-Uso";

/** O interruptor gravado em `plataforma_config` está ligado? Sem a linha, desligado. */
export function subcontasBaasLigadas(valor: number | string | null | undefined): boolean {
  return Number(valor) === 1;
}

/**
 * O caminho da subconta está aberto para esta organização? Com o interruptor
 * ligado, para todas; desligado, só para a organização em `trial`, que fala
 * com o sandbox, onde nada de verdade é criado. É o que deixa tirar o print
 * da tela de abertura (pedido no formulário de habilitação do BaaS) na
 * academia de homologação, sem ligar o interruptor em produção.
 */
export function subcontaDisponivel(valorInterruptor: number | string | null | undefined, statusOrganizacao: string | null | undefined): boolean {
  return subcontasBaasLigadas(valorInterruptor) || statusOrganizacao === "trial";
}

/** A mensagem de quando o caminho está fechado. */
export const SUBCONTA_DESLIGADA =
  "A abertura da conta Asaas pela ArkeFit está desligada. Abra a conta da academia no site do Asaas (é gratuita) e informe a carteira aqui.";

/**
 * O aceite que a tela manda antes de abrir a conta: o titular marcou que leu
 * e aceita os Termos do Asaas, e o endereço é o que a tela mostrou.
 */
export function aceiteDosTermos(corpo: { aceite_termos?: unknown; termos_url?: unknown }): { ok: true } | { ok: false; erro: string } {
  if (corpo.aceite_termos !== true) {
    return { ok: false, erro: "Para abrir a conta, o titular aceita os Termos de Uso do Asaas, que mantém a conta em nome da academia." };
  }
  if (corpo.termos_url !== TERMOS_ASAAS_URL) {
    return { ok: false, erro: "Os Termos de Uso do Asaas mudaram de endereço. Recarregue a página e aceite de novo." };
  }
  return { ok: true };
}

type ErrosAsaas = { errors?: { code?: string; description?: string }[] };
type RespostaAsaas<T> = { ok: boolean; status: number; corpo: T & ErrosAsaas };

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<RespostaAsaas<T>> {
  const resp = await fetch(api + caminho, {
    signal: AbortSignal.timeout(20_000),
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

// ## Documentos da subconta, no formato BaaS
//
// No BaaS, a academia não vai ao painel do Asaas mandar documento: o ARKE
// mostra o que falta e abre o link que o Asaas dá para cada grupo
// (`onboardingUrl`), onde o titular envia o documento e faz a selfie. A
// consulta é `GET /myAccount/documents`, com a chave da **subconta**
// (docs.asaas.com, "Verificar documentos pendentes", conferido em 06/10/2026).
// O Asaas pede ao menos 15 segundos depois da criação antes de consultar:
// antes disso a lista pode trazer documento que não será exigido. Grupo com
// link não se envia pela API (o Asaas recusa); grupo sem link é envio pela
// API, que fica para quando houver o caso (associação, ata de eleição).

export type GrupoDeDocumentos = {
  id: string;
  /** NOT_SENT, PENDING, APPROVED, REJECTED ou IGNORED. */
  status: string;
  tipo: string;
  titulo: string;
  descricao: string | null;
  /** De quem é o documento (o sócio, o diretor...), como o Asaas descreve. */
  responsavel: string | null;
  link: string | null;
  linkExpiraEm: string | null;
};

/** O que ainda pede ação do titular: não enviado ou recusado. */
export function grupoPendente(g: Pick<GrupoDeDocumentos, "status">): boolean {
  return g.status === "NOT_SENT" || g.status === "REJECTED";
}

/** Só endereço https do Asaas (ou do parceiro dele) vira botão: nada de `javascript:` vindo de fora. */
function linkSeguro(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  try {
    const u = new URL(valor);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function documentosDaSubconta(
  api: string,
  chaveSubconta: string,
): Promise<{ ok: true; grupos: GrupoDeDocumentos[]; motivoRecusa: string | null } | { ok: false; erro: string }> {
  const r = await chamar<{
    rejectReasons?: string | null;
    data?: {
      id?: string;
      status?: string;
      type?: string;
      title?: string;
      description?: string | null;
      responsible?: { name?: string | null } | null;
      onboardingUrl?: string | null;
      onboardingUrlExpirationDate?: string | null;
    }[];
  }>(api, chaveSubconta, "GET", "/myAccount/documents");
  if (!r.ok) {
    console.error("Asaas: falha ao consultar documentos", r.status, r.corpo?.errors?.map((e) => e.code) ?? []);
    return { ok: false, erro: mensagemAsaas(r.corpo, "Não foi possível consultar os documentos no Asaas agora.") };
  }
  const grupos = (r.corpo.data ?? [])
    .filter((g) => g.id && g.status !== "IGNORED")
    .map((g) => ({
      id: String(g.id),
      status: String(g.status ?? "NOT_SENT"),
      tipo: String(g.type ?? "CUSTOM"),
      titulo: g.title?.trim() || "Documento",
      descricao: g.description?.trim() || null,
      responsavel: g.responsible?.name?.trim() || null,
      link: linkSeguro(g.onboardingUrl),
      linkExpiraEm: g.onboardingUrlExpirationDate ?? null,
    }));
  return { ok: true, grupos, motivoRecusa: r.corpo.rejectReasons?.trim() || null };
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

// ## Troca da carteira
//
// A carteira é para onde o split manda a parte da academia em toda cobrança
// futura. Uma sessão de gestor roubada que a troca desvia o dinheiro sem
// barulho. Por isso a troca (não a primeira vinculação, do onboarding) pede
// as duas etapas, fica na auditoria e avisa a ArkeFit por e-mail.

/** É troca: já havia uma carteira, e a nova é outra. */
export function ehTrocaDeCarteira(anterior: string | null | undefined, nova: string): boolean {
  return !!anterior && anterior.trim().toLowerCase() !== nova.trim().toLowerCase();
}

/** Só o fim da carteira vai no e-mail; o id inteiro fica na auditoria, que só a ArkeFit lê. */
export function finalDaCarteira(carteira: string | null | undefined): string {
  const c = (carteira ?? "").trim();
  return c ? `…${c.slice(-6)}` : "nenhuma";
}

/** O e-mail para a ArkeFit quando a carteira de uma academia muda. */
export function avisoDeTrocaDeCarteira(a: {
  academia: string;
  papel: "gestor" | "arkefit";
  anterior: string | null;
  nova: string;
  quando: string;
  painel: string;
}): { assunto: string; texto: string; html: string } {
  const quem = a.papel === "gestor" ? "pela gestão da academia, com as duas etapas" : "pela equipe ArkeFit";
  const linhas = [
    `A carteira de recebimento de ${a.academia} foi trocada ${quem}, em ${a.quando}.`,
    `Antes: ${finalDaCarteira(a.anterior)}. Agora: ${finalDaCarteira(a.nova)}.`,
    "As cobranças criadas daqui em diante mandam a parte da academia para a carteira nova.",
    "Se a academia emite nota fiscal pelo ARKE, as notas novas esperam até ela conectar a chave da conta nova em Financeiro → Notas fiscais.",
    "Se ninguém da academia pediu esta troca, confira com o gestor antes da próxima cobrança. O registro completo está na auditoria da Visão Master.",
    a.painel,
  ];
  const texto = linhas.join("\n\n");
  const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${linhas
    .map((l) => `<p style="margin:0 0 12px">${escapar(l)}</p>`)
    .join("")}</div>`;
  return { assunto: `ARKE: carteira de recebimento trocada — ${a.academia}`, texto, html };
}

/**
 * NFS-e da academia no Asaas: cadastro fiscal, serviço municipal, cliente,
 * emissão, acompanhamento e cancelamento.
 *
 * Sem Deno e sem Supabase de propósito, para `npm run sandbox:nfse` exercitar
 * este código e não uma cópia — o mesmo critério dos outros `fluxo.ts`.
 *
 * Tudo aqui roda com a chave da **conta Asaas da academia**, nunca com a da
 * ArkeFit: a responsabilidade fiscal segue o split, e a nota da academia sai
 * no CNPJ dela. Como o dinheiro chega a ela pelo split (a cobrança está na
 * conta da ArkeFit), a nota é avulsa, por cliente — o aluno é cadastrado como
 * cliente também na conta da academia.
 *
 * O que o sandbox ensinou (24/09/2026):
 *   * o cadastro fiscal aceita dados parciais, mas a emissão recusa enquanto
 *     não houver autenticação na prefeitura ("informar ao menos um meio de
 *     autenticação ao site da prefeitura") — por isso `pronta` olha os
 *     `...Sent` que o próprio Asaas devolve;
 *   * a prefeitura exige o endereço do tomador: sem ele o `authorize` responde
 *     "Endereço do cliente incompleto; CEP do cliente é inválido", e a nota
 *     fica SCHEDULED;
 *   * a nota passa por SCHEDULED → SYNCHRONIZED → AUTHORIZED em segundos, com
 *     número, PDF e XML; cancelar leva a PROCESSING_CANCELLATION → CANCELED.
 */

type Resposta<T> = { ok: boolean; status: number; corpo: T & { errors?: { code?: string; description?: string }[] } };

/** Falha de rede ou tempo esgotado: o Asaas pode ter feito o que se pediu. */
export class FalhaIndefinida extends Error {}

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  let resp: Response;
  const headers: Record<string, string> = { access_token: chave };
  let body: BodyInit | undefined;
  if (corpo instanceof FormData) body = corpo;
  else if (corpo !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(corpo);
  }
  try {
    resp = await fetch(`${api}${caminho}`, { method: metodo, headers, body, signal: AbortSignal.timeout(20_000) });
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

export function descricaoErro(corpo: { errors?: { description?: string }[] }): string | null {
  return corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;
}

/**
 * A chave da academia tem de ser do mesmo ambiente da organização: chave de
 * produção numa academia em homologação emitiria nota de verdade a partir de
 * um teste, e o contrário emitiria nota de mentira para cliente real.
 */
export function chaveCombinaComAmbiente(chave: string, ambiente: "sandbox" | "producao"): boolean {
  const deSandbox = chave.startsWith("$aact_hmlg_");
  return ambiente === "sandbox" ? deSandbox : !deSandbox && chave.startsWith("$aact_");
}

// --- Conta e cadastro fiscal -------------------------------------------------

/** A carteira da conta dona da chave — é o que prova que a chave é da academia. */
export async function carteiraDaChave(api: string, chave: string): Promise<string | null> {
  const r = await chamar<{ data?: { id: string }[] }>(api, chave, "GET", "/wallets");
  if (!r.ok) return null;
  return r.corpo.data?.[0]?.id ?? null;
}

export type OpcoesMunicipais = {
  authenticationType: "CERTIFICATE" | "TOKEN" | "USER_AND_PASSWORD" | null;
  supportsCancellation: boolean;
  usesSpecialTaxRegimes: boolean;
  usesServiceListItem: boolean;
  specialTaxRegimesList: { value: string; label: string }[];
  nationalPortalTaxCalculationRegimeList: { value: string; label: string }[];
  municipalInscriptionHelp: string | null;
  specialTaxRegimeHelp: string | null;
  serviceListItemHelp: string | null;
  digitalCertificatedHelp: string | null;
  accessTokenHelp: string | null;
  municipalServiceCodeHelp: string | null;
  nationalPortalTaxCalculationRegimeHelp: string | null;
};

export async function opcoesMunicipais(api: string, chave: string): Promise<OpcoesMunicipais | null> {
  const r = await chamar<OpcoesMunicipais>(api, chave, "GET", "/fiscalInfo/municipalOptions");
  return r.ok ? r.corpo : null;
}

/** Só o que não é segredo: o Asaas devolve se certificado/senha/token foram enviados, nunca o valor. */
export type CadastroFiscal = {
  simplesNacional: boolean | null;
  municipalInscription: string | null;
  specialTaxRegime: string | null;
  nationalPortalTaxCalculationRegime: string | null;
  serviceListItem: string | null;
  cnae: string | null;
  rpsSerie: string | null;
  rpsNumber: number | null;
  email: string | null;
  useNationalPortal: boolean | null;
  certificateSent: boolean;
  passwordSent: boolean;
  accessTokenSent: boolean;
};

export async function cadastroFiscal(api: string, chave: string): Promise<CadastroFiscal | null> {
  const r = await chamar<Partial<CadastroFiscal> & { username?: string | null }>(api, chave, "GET", "/fiscalInfo");
  if (r.status === 404) return null;
  if (!r.ok) throw new FalhaIndefinida(`fiscalInfo respondeu ${r.status}`);
  const c = r.corpo;
  return {
    simplesNacional: c.simplesNacional ?? null,
    municipalInscription: c.municipalInscription ?? null,
    specialTaxRegime: c.specialTaxRegime ?? null,
    nationalPortalTaxCalculationRegime: c.nationalPortalTaxCalculationRegime ?? null,
    serviceListItem: c.serviceListItem ?? null,
    cnae: c.cnae ?? null,
    rpsSerie: c.rpsSerie ?? null,
    rpsNumber: c.rpsNumber ?? null,
    email: c.email ?? null,
    useNationalPortal: c.useNationalPortal ?? null,
    // Usuário e senha da prefeitura contam juntos: o Asaas devolve só se a senha foi enviada.
    certificateSent: !!c.certificateSent,
    passwordSent: !!c.passwordSent,
    accessTokenSent: !!c.accessTokenSent,
  };
}

/** A autenticação que a prefeitura exige já foi enviada ao Asaas? */
export function autenticacaoEnviada(
  exigida: OpcoesMunicipais["authenticationType"],
  cadastro: Pick<CadastroFiscal, "certificateSent" | "passwordSent" | "accessTokenSent"> | null,
): boolean {
  if (!cadastro) return false;
  if (exigida === "CERTIFICATE") return cadastro.certificateSent;
  if (exigida === "USER_AND_PASSWORD") return cadastro.passwordSent;
  if (exigida === "TOKEN") return cadastro.accessTokenSent;
  // Prefeitura sem exigência informada: qualquer meio enviado basta, que é o
  // que o Asaas cobra na emissão.
  return cadastro.certificateSent || cadastro.passwordSent || cadastro.accessTokenSent;
}

/**
 * Envia o cadastro fiscal ao Asaas (multipart, porque pode levar o
 * certificado). Certificado e senhas atravessam, não ficam: quem chama não
 * guarda nada disso, e aqui nada vai para log.
 */
export async function enviarCadastroFiscal(api: string, chave: string, formulario: FormData): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await chamar<unknown>(api, chave, "POST", "/fiscalInfo", formulario);
  if (r.ok) return { ok: true };
  return { ok: false, erro: descricaoErro(r.corpo) ?? `O Asaas recusou o cadastro fiscal (HTTP ${r.status}).` };
}

export type ServicoMunicipal = { id: string; descricao: string; iss: number | null };

export async function buscarServicos(api: string, chave: string, termo: string): Promise<ServicoMunicipal[]> {
  const q = encodeURIComponent(termo.trim());
  const r = await chamar<{ data?: { id: string; description: string; issTax?: number | null }[] }>(
    api,
    chave,
    "GET",
    `/fiscalInfo/services?description=${q}&limit=20`,
  );
  if (!r.ok) return [];
  return (r.corpo.data ?? []).map((s) => ({ id: String(s.id), descricao: s.description, iss: s.issTax ?? null }));
}

// --- Cliente (o aluno, na conta da academia) --------------------------------

export type Tomador = {
  alunoId: string;
  nome: string;
  cpf: string;
  email: string | null;
  endereco: { cep: string; logradouro: string; numero: string; complemento: string | null; bairro: string };
};

/** O endereço que a prefeitura exige do tomador está completo? */
export function enderecoCompleto(e: Partial<Tomador["endereco"]> | null | undefined): boolean {
  return !!e && /^\d{8}$/.test(e.cep ?? "") && !!e.logradouro?.trim() && !!e.numero?.trim() && !!e.bairro?.trim();
}

/**
 * O aluno como cliente na conta da academia: procura pelo id do aluno, depois
 * pelo CPF, e atualiza o endereço — a nota sai com o endereço de hoje.
 * `notificationDisabled`: a conta da academia não cobra nada deste cliente,
 * e a nota em si o Asaas manda por e-mail mesmo assim.
 */
export async function garantirCliente(api: string, chave: string, t: Tomador): Promise<{ id: string } | { erro: string }> {
  if (t.cpf.length !== 11) return { erro: "CPF do aluno ausente ou inválido." };
  const dados = {
    name: t.nome,
    cpfCnpj: t.cpf,
    email: t.email ?? undefined,
    externalReference: t.alunoId,
    postalCode: t.endereco.cep,
    address: t.endereco.logradouro,
    addressNumber: t.endereco.numero,
    complement: t.endereco.complemento ?? undefined,
    province: t.endereco.bairro,
    notificationDisabled: true,
  };
  for (const filtro of [`externalReference=${encodeURIComponent(t.alunoId)}`, `cpfCnpj=${t.cpf}`]) {
    const busca = await chamar<{ data?: { id: string; deleted?: boolean }[] }>(api, chave, "GET", `/customers?${filtro}`);
    const existente = busca.ok ? busca.corpo.data?.find((c) => !c.deleted) : undefined;
    if (existente) {
      const atualizado = await chamar<{ id: string }>(api, chave, "POST", `/customers/${existente.id}`, dados);
      if (!atualizado.ok) return { erro: descricaoErro(atualizado.corpo) ?? "Falha ao atualizar o cliente na conta da academia." };
      return { id: existente.id };
    }
  }
  const criado = await chamar<{ id: string }>(api, chave, "POST", "/customers", dados);
  if (!criado.ok) return { erro: descricaoErro(criado.corpo) ?? "Falha ao criar o cliente na conta da academia." };
  return { id: criado.corpo.id };
}

// --- Nota ---------------------------------------------------------------------

export type NotaAsaas = {
  id: string;
  status: string;
  number?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  statusDescription?: string | null;
  deleted?: boolean;
};

export type PedidoNota = {
  referencia: string;
  cliente: string;
  descricao: string;
  observacoes: string;
  valor: number;
  data: string;
  servico: { id: string | null; codigo: string | null; nome: string };
  iss: number;
};

async function notaPorReferencia(api: string, chave: string, referencia: string): Promise<NotaAsaas | null> {
  const r = await chamar<{ data?: NotaAsaas[] }>(api, chave, "GET", `/invoices?externalReference=${encodeURIComponent(referencia)}`);
  if (!r.ok) throw new FalhaIndefinida(`consulta de notas respondeu ${r.status}`);
  return r.corpo.data?.find((n) => !n.deleted && n.status !== "CANCELED") ?? null;
}

export type ResultadoEmissao =
  | { ok: true; nota: NotaAsaas }
  /** `nota` presente: foi criada e ficou agendada, mas a emissão recusou (endereço, cadastro). */
  | { ok: false; erro: string; definitivo: boolean; nota?: NotaAsaas };

/**
 * Agenda e emite. Idempotente pela referência (`nfse:<id da linha>`): nota já
 * criada para a linha é adotada — é o caso da resposta que se perdeu, e o de
 * "tentar de novo" depois de corrigir o endereço.
 */
export async function emitirNota(api: string, chave: string, p: PedidoNota): Promise<ResultadoEmissao> {
  try {
    let nota = await notaPorReferencia(api, chave, p.referencia);
    if (!nota) {
      const criada = await chamar<NotaAsaas>(api, chave, "POST", "/invoices", {
        customer: p.cliente,
        serviceDescription: p.descricao,
        observations: p.observacoes,
        value: p.valor,
        deductions: 0,
        effectiveDate: p.data,
        externalReference: p.referencia,
        ...(p.servico.id ? { municipalServiceId: p.servico.id } : { municipalServiceCode: p.servico.codigo }),
        municipalServiceName: p.servico.nome,
        // Tributos federais ficam em zero: a academia do Simples recolhe pelo
        // DAS, e retenção na fonte é caso de tomador empresa, não de aluno.
        taxes: { retainIss: false, iss: p.iss, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
      });
      if (!criada.ok) {
        const erro = descricaoErro(criada.corpo) ?? `O Asaas recusou a nota (HTTP ${criada.status}).`;
        return { ok: false, erro, definitivo: criada.status >= 400 && criada.status < 500 };
      }
      nota = criada.corpo;
    }
    if (nota.status === "SCHEDULED") {
      const aut = await chamar<NotaAsaas>(api, chave, "POST", `/invoices/${nota.id}/authorize`);
      if (!aut.ok) {
        const erro = descricaoErro(aut.corpo) ?? `O Asaas não emitiu a nota (HTTP ${aut.status}).`;
        return { ok: false, erro, definitivo: aut.status >= 400 && aut.status < 500, nota };
      }
      nota = aut.corpo;
    }
    return { ok: true, nota };
  } catch (e) {
    if (e instanceof FalhaIndefinida) return { ok: false, erro: "Não foi possível falar com o Asaas agora.", definitivo: false };
    throw e;
  }
}

export async function consultarNota(api: string, chave: string, id: string): Promise<NotaAsaas | null> {
  const r = await chamar<NotaAsaas>(api, chave, "GET", `/invoices/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new FalhaIndefinida(`consulta da nota respondeu ${r.status}`);
  return r.corpo;
}

export async function cancelarNota(api: string, chave: string, id: string): Promise<{ ok: true; nota: NotaAsaas } | { ok: false; erro: string }> {
  try {
    const r = await chamar<NotaAsaas>(api, chave, "POST", `/invoices/${encodeURIComponent(id)}/cancel`);
    if (r.ok) return { ok: true, nota: r.corpo };
    return { ok: false, erro: descricaoErro(r.corpo) ?? `O Asaas não cancelou a nota (HTTP ${r.status}).` };
  } catch (e) {
    if (e instanceof FalhaIndefinida) return { ok: false, erro: "Não foi possível falar com o Asaas agora." };
    throw e;
  }
}

/**
 * Situação da nota no Asaas → situação da linha no ARKE. `null`: ainda em
 * andamento. Cancelamento negado não é erro da nota: ela continua valendo,
 * e a linha volta a "emitida" com o motivo.
 */
export function situacaoDaNota(statusAsaas: string): "emitida" | "erro" | "cancelada" | "cancelando" | "cancelamento_negado" | null {
  switch (statusAsaas) {
    case "AUTHORIZED":
      return "emitida";
    case "ERROR":
      return "erro";
    case "CANCELLATION_DENIED":
      return "cancelamento_negado";
    case "CANCELED":
      return "cancelada";
    case "PROCESSING_CANCELLATION":
      return "cancelando";
    default:
      // SCHEDULED, SYNCHRONIZED: a prefeitura ainda está processando.
      return null;
  }
}

/** Cidade e UF da conta da academia — é a prefeitura dessa cidade que emite. */
export async function cidadeDaConta(api: string, chave: string): Promise<{ cidade: string | null; uf: string | null }> {
  const r = await chamar<{ city?: { name?: string; state?: string } | string | null; state?: string | null }>(
    api,
    chave,
    "GET",
    "/myAccount/commercialInfo",
  );
  if (!r.ok) return { cidade: null, uf: null };
  const c = r.corpo.city;
  const cidade = typeof c === "string" ? c : c?.name ?? null;
  const uf = (typeof c === "object" && c?.state) || r.corpo.state || null;
  return { cidade, uf };
}

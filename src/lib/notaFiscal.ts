import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

/**
 * Nota fiscal automática da academia (NFS-e). A responsabilidade fiscal segue
 * o split: a academia emite, no CNPJ dela, a nota do que entra no caixa dela.
 * A configuração é dela; o ARKE transmite ao Asaas e acompanha a emissão.
 */

export type StatusNota = "pendente" | "sem_endereco" | "agendada" | "emitida" | "erro" | "cancelar" | "cancelando" | "cancelada";

export const ROTULO_STATUS_NOTA: Record<StatusNota, string> = {
  pendente: "Na fila",
  sem_endereco: "Falta o endereço do aluno",
  agendada: "Na prefeitura",
  emitida: "Emitida",
  erro: "Erro",
  cancelar: "Cancelando",
  cancelando: "Cancelando",
  cancelada: "Cancelada",
};

export const ROTULO_ORIGEM_NOTA: Record<string, string> = {
  mensalidade: "Mensalidade",
  avulsa: "Cobrança avulsa",
  metodo: "Método ARKE",
};

export type Autenticacao = "CERTIFICATE" | "TOKEN" | "USER_AND_PASSWORD";

export type OpcoesMunicipais = {
  authenticationType: Autenticacao | null;
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
  nationalPortalTaxCalculationRegimeHelp: string | null;
};

export type CadastroFiscal = {
  simplesNacional: boolean | null;
  municipalInscription: string | null;
  specialTaxRegime: string | null;
  nationalPortalTaxCalculationRegime: string | null;
  serviceListItem: string | null;
  cnae: string | null;
  email: string | null;
  certificateSent: boolean;
  passwordSent: boolean;
  accessTokenSent: boolean;
};

export type ConfigFiscal = {
  emissao_ativa: boolean;
  servico_municipal_id: string | null;
  servico_municipal_codigo: string | null;
  servico_municipal_nome: string | null;
  aliquota_iss: number | null;
  observacoes: string | null;
};

export type SituacaoFiscal =
  | { conectada: false; possuiCarteira: boolean }
  | {
      conectada: true;
      cidade: string | null;
      uf: string | null;
      opcoes: OpcoesMunicipais | null;
      cadastro: CadastroFiscal | null;
      config: ConfigFiscal | null;
      pronta: boolean;
    };

export type ServicoMunicipal = { id: string; descricao: string; iss: number | null };

export const ROTULO_AUTENTICACAO: Record<Autenticacao, string> = {
  CERTIFICATE: "certificado digital A1",
  USER_AND_PASSWORD: "usuário e senha do portal da prefeitura",
  TOKEN: "token de acesso da prefeitura",
};

/** A autenticação que a prefeitura exige já foi enviada? Espelho de `autenticacaoEnviada` no fluxo da edge function. */
export function autenticacaoOk(s: Extract<SituacaoFiscal, { conectada: true }>): boolean {
  const c = s.cadastro;
  if (!c) return false;
  const exigida = s.opcoes?.authenticationType ?? null;
  if (exigida === "CERTIFICATE") return c.certificateSent;
  if (exigida === "USER_AND_PASSWORD") return c.passwordSent;
  if (exigida === "TOKEN") return c.accessTokenSent;
  return c.certificateSent || c.passwordSent || c.accessTokenSent;
}

async function chamar<T>(corpo: Record<string, unknown> | FormData, padrao: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("asaas-fiscal-academia", { body: corpo });
  if (error) throw new Error(await mensagemDeErroEdge(error, padrao));
  return data as T;
}

export const situacaoFiscal = (organizationId: string) =>
  chamar<SituacaoFiscal>({ acao: "situacao", organization_id: organizationId }, "Não foi possível consultar a nota fiscal.");

export const conectarConta = (organizationId: string, chave: string) =>
  chamar<SituacaoFiscal>({ acao: "chave", organization_id: organizationId, chave }, "Não foi possível conectar a conta.");

export const buscarServicosMunicipais = async (organizationId: string, termo: string) =>
  (await chamar<{ servicos: ServicoMunicipal[] }>({ acao: "servicos", organization_id: organizationId, termo }, "Não foi possível buscar os serviços.")).servicos;

/** Certificado e senhas vão no formulário direto para o Asaas; nada disso fica no ARKE. */
export function enviarCadastroFiscal(organizationId: string, campos: Record<string, string | File | null | undefined>) {
  const f = new FormData();
  f.append("acao", "cadastro");
  f.append("organization_id", organizationId);
  for (const [k, v] of Object.entries(campos)) {
    if (v === null || v === undefined || v === "") continue;
    f.append(k, v);
  }
  return chamar<SituacaoFiscal>(f, "O Asaas não aceitou o cadastro fiscal.");
}

export const salvarConfigFiscal = (organizationId: string, config: ConfigFiscal) =>
  chamar<SituacaoFiscal>({ acao: "config", organization_id: organizationId, ...config }, "Não foi possível salvar.");

// --- Endereço do aluno -------------------------------------------------------

export type Endereco = {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export const ENDERECO_VAZIO: Endereco = { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" };

/** Tudo o que a prefeitura exige do tomador está preenchido? (Complemento é opcional.) */
export function enderecoCompleto(e: Endereco): boolean {
  return (
    e.cep.replace(/\D/g, "").length === 8 &&
    !!e.logradouro.trim() &&
    !!e.numero.trim() &&
    !!e.bairro.trim() &&
    !!e.cidade.trim() &&
    /^[A-Za-z]{2}$/.test(e.uf.trim())
  );
}

export async function salvarEndereco(alunoId: string, e: Endereco): Promise<void> {
  const { error } = await supabase.rpc("atualizar_endereco_aluno", {
    _aluno_id: alunoId,
    _cep: e.cep,
    _logradouro: e.logradouro,
    _numero: e.numero,
    _complemento: e.complemento,
    _bairro: e.bairro,
    _cidade: e.cidade,
    _uf: e.uf,
  });
  if (error) throw new Error(error.message);
}

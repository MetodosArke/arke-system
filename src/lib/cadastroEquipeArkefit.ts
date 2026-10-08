/**
 * O cadastro completo da equipe da ArkeFit (08/10/2026): o que o contrato
 * social, a contabilidade e a folha pedem de cada pessoa. A tabela é
 * `equipe_arkefit_cadastro` (migration 20261430010000), e só a função
 * `salvar_cadastro_equipe_arkefit` grava.
 *
 * Quem vê: os sócios (com as duas etapas) e a própria pessoa. A pessoa muda
 * os dados dela e onde recebe; o vínculo, a remuneração, a participação e as
 * observações, só um sócio. As duas listas abaixo espelham as do banco
 * (`campos_cadastro_equipe_pessoais()` e `campos_cadastro_equipe_do_socio()`),
 * e `cadastroEquipeArkefit.guarda.test.ts` confere que são as mesmas.
 */
import type { Tables } from "@/integrations/supabase/types";
import { formatarCep } from "@/lib/brasilApi";
import { erroCpf, formatarCpf, somenteDigitos } from "@/lib/cpf";
import { dataBr, type Aba, type Celula } from "@/lib/exportarPlanilha";
import { lerReais } from "@/lib/numeros";

export type CadastroEquipe = Tables<"equipe_arkefit_cadastro">;

/** Os campos que a própria pessoa muda (o espelho do banco). */
export const CAMPOS_PESSOAIS = [
  "nome_completo",
  "nome_social",
  "cpf",
  "rg_numero",
  "rg_orgao_emissor",
  "rg_uf",
  "rg_data_emissao",
  "data_nascimento",
  "nacionalidade",
  "naturalidade_cidade",
  "naturalidade_uf",
  "estado_civil",
  "regime_bens",
  "profissao",
  "nome_mae",
  "nome_pai",
  "telefone",
  "email_contato",
  "endereco_cep",
  "endereco_logradouro",
  "endereco_numero",
  "endereco_complemento",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_uf",
  "pis_pasep_nit",
  "ctps_numero",
  "ctps_serie",
  "titulo_eleitor",
  "banco",
  "agencia",
  "conta",
  "conta_tipo",
  "pix_tipo",
  "pix_chave",
] as const;

/** Os campos que só um sócio muda (o espelho do banco). A pessoa lê. */
export const CAMPOS_DO_SOCIO = [
  "vinculo_tipo",
  "cargo",
  "data_entrada",
  "data_saida",
  "pj_cnpj",
  "pj_razao_social",
  "participacao_capital",
  "socio_administrador",
  "remuneracao_mensal",
  "observacoes",
] as const;

export type CampoPessoal = (typeof CAMPOS_PESSOAIS)[number];
export type CampoDoSocio = (typeof CAMPOS_DO_SOCIO)[number];
export type CampoCadastro = CampoPessoal | CampoDoSocio;
type CampoDeTexto = Exclude<CampoCadastro, "socio_administrador">;

/** O formulário: todo campo como texto, menos o "sócio administrador". */
export type FormCadastro = Record<CampoDeTexto, string> & { socio_administrador: boolean };

export type Opcao = { id: string; nome: string };

export const VINCULOS: Opcao[] = [
  { id: "socio", nome: "Sócio" },
  { id: "clt", nome: "CLT" },
  { id: "pj", nome: "PJ" },
  { id: "autonomo", nome: "Autônomo (RPA)" },
  { id: "estagio", nome: "Estágio" },
];

export const ESTADOS_CIVIS: Opcao[] = [
  { id: "solteiro", nome: "Solteiro(a)" },
  { id: "casado", nome: "Casado(a)" },
  { id: "uniao_estavel", nome: "União estável" },
  { id: "separado", nome: "Separado(a)" },
  { id: "divorciado", nome: "Divorciado(a)" },
  { id: "viuvo", nome: "Viúvo(a)" },
];

export const REGIMES_DE_BENS: Opcao[] = [
  { id: "comunhao_parcial", nome: "Comunhão parcial de bens" },
  { id: "comunhao_universal", nome: "Comunhão universal de bens" },
  { id: "separacao_total", nome: "Separação total de bens" },
  { id: "separacao_obrigatoria", nome: "Separação obrigatória de bens" },
  { id: "participacao_final_aquestos", nome: "Participação final nos aquestos" },
];

export const TIPOS_DE_CONTA: Opcao[] = [
  { id: "corrente", nome: "Corrente" },
  { id: "poupanca", nome: "Poupança" },
  { id: "pagamento", nome: "Pagamento" },
  { id: "salario", nome: "Salário" },
];

export const TIPOS_DE_PIX: Opcao[] = [
  { id: "cpf", nome: "CPF" },
  { id: "cnpj", nome: "CNPJ" },
  { id: "email", nome: "E-mail" },
  { id: "telefone", nome: "Telefone" },
  { id: "aleatoria", nome: "Chave aleatória" },
];

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Casado ou em união estável: o contrato social pede o regime de bens. */
export const temRegimeDeBens = (estadoCivil: string) => estadoCivil === "casado" || estadoCivil === "uniao_estavel";

/** O nome da remuneração combinada, pelo vínculo. */
export function rotuloRemuneracao(vinculo: string): string {
  if (vinculo === "socio") return "Pró-labore mensal";
  if (vinculo === "clt") return "Salário mensal";
  if (vinculo === "estagio") return "Bolsa-auxílio mensal";
  if (vinculo === "pj" || vinculo === "autonomo") return "Valor mensal do contrato";
  return "Remuneração mensal";
}

export const nomeDaOpcao = (opcoes: Opcao[], id: string | null | undefined) => opcoes.find((o) => o.id === id)?.nome ?? "";

/** (11) 98765-4321, enquanto digita. */
export function formatarTelefone(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** 000.000.000-00, enquanto digita. */
export function mascararCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 000.00000.00-0, o PIS, o PASEP e o NIT. */
export function formatarPis(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 8) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}.${d.slice(3, 8)}.${d.slice(8)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 8)}.${d.slice(8, 10)}-${d.slice(10)}`;
}

/**
 * O CNPJ, inclusive o alfanumérico da Receita (desde julho de 2026): 12
 * letras ou dígitos e 2 dígitos verificadores. A conta dos dígitos é a do
 * módulo 11 sobre o valor de cada caractere (código ASCII menos 48).
 */
export function cnpjValidoAlfanumerico(valor: string): boolean {
  const c = valor.toUpperCase().replace(/[./\s-]/g, "");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split("").reduce((s, ch, i) => s + (ch.charCodeAt(0) - 48) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export function formatarCnpjAlfanumerico(valor: string): string {
  const c = valor.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14);
  return c
    .replace(/^(.{2})(.)/, "$1.$2")
    .replace(/^(.{2})\.(.{3})(.)/, "$1.$2.$3")
    .replace(/^(.{2})\.(.{3})\.(.{3})(.)/, "$1.$2.$3/$4")
    .replace(/^(.{2})\.(.{3})\.(.{3})\/(.{4})(.)/, "$1.$2.$3/$4-$5");
}

/** O número de um campo de valor ou percentual, para a tela: "4.500,50". */
const paraTexto = (n: number | null) =>
  n === null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** O formulário a partir do que está gravado (ou vazio, com o nome da conta). */
export function formDoCadastro(c: CadastroEquipe | null, nomeDaConta = ""): FormCadastro {
  const texto = (v: string | null | undefined) => v ?? "";
  return {
    nome_completo: c?.nome_completo ?? nomeDaConta,
    nome_social: texto(c?.nome_social),
    cpf: c?.cpf ? formatarCpf(c.cpf) : "",
    rg_numero: texto(c?.rg_numero),
    rg_orgao_emissor: texto(c?.rg_orgao_emissor),
    rg_uf: texto(c?.rg_uf),
    rg_data_emissao: texto(c?.rg_data_emissao),
    data_nascimento: texto(c?.data_nascimento),
    nacionalidade: c ? texto(c.nacionalidade) : "Brasileira",
    naturalidade_cidade: texto(c?.naturalidade_cidade),
    naturalidade_uf: texto(c?.naturalidade_uf),
    estado_civil: texto(c?.estado_civil),
    regime_bens: texto(c?.regime_bens),
    profissao: texto(c?.profissao),
    nome_mae: texto(c?.nome_mae),
    nome_pai: texto(c?.nome_pai),
    telefone: c?.telefone ? formatarTelefone(c.telefone) : "",
    email_contato: texto(c?.email_contato),
    endereco_cep: c?.endereco_cep ? formatarCep(c.endereco_cep) : "",
    endereco_logradouro: texto(c?.endereco_logradouro),
    endereco_numero: texto(c?.endereco_numero),
    endereco_complemento: texto(c?.endereco_complemento),
    endereco_bairro: texto(c?.endereco_bairro),
    endereco_cidade: texto(c?.endereco_cidade),
    endereco_uf: texto(c?.endereco_uf),
    pis_pasep_nit: c?.pis_pasep_nit ? formatarPis(c.pis_pasep_nit) : "",
    ctps_numero: texto(c?.ctps_numero),
    ctps_serie: texto(c?.ctps_serie),
    titulo_eleitor: texto(c?.titulo_eleitor),
    vinculo_tipo: texto(c?.vinculo_tipo),
    cargo: texto(c?.cargo),
    data_entrada: texto(c?.data_entrada),
    data_saida: texto(c?.data_saida),
    pj_cnpj: c?.pj_cnpj ? formatarCnpjAlfanumerico(c.pj_cnpj) : "",
    pj_razao_social: texto(c?.pj_razao_social),
    participacao_capital: paraTexto(c?.participacao_capital ?? null),
    socio_administrador: c?.socio_administrador ?? false,
    remuneracao_mensal: paraTexto(c?.remuneracao_mensal ?? null),
    banco: texto(c?.banco),
    agencia: texto(c?.agencia),
    conta: texto(c?.conta),
    conta_tipo: texto(c?.conta_tipo),
    pix_tipo: texto(c?.pix_tipo),
    pix_chave: texto(c?.pix_chave),
    observacoes: texto(c?.observacoes),
  };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * O que está errado no formulário, campo a campo, antes de ir ao banco (que
 * confere de novo). `hoje` é a data de Brasília (`hojeBrasilia()`), e as datas
 * se comparam como texto.
 */
export function errosDoCadastro(f: FormCadastro, hoje: string): Partial<Record<CampoCadastro, string>> {
  const e: Partial<Record<CampoCadastro, string>> = {};
  const nome = f.nome_completo.trim();
  if (nome.length < 3) e.nome_completo = "Informe o nome completo.";
  const cpf = erroCpf(f.cpf);
  if (cpf) e.cpf = cpf;
  const cep = somenteDigitos(f.endereco_cep);
  if (cep && cep.length !== 8) e.endereco_cep = "O CEP tem 8 dígitos.";
  const telefone = somenteDigitos(f.telefone);
  if (telefone && (telefone.length < 10 || telefone.length > 13)) e.telefone = "Telefone com DDD, de 10 ou 11 dígitos.";
  if (f.email_contato.trim() && !EMAIL.test(f.email_contato.trim())) e.email_contato = "E-mail inválido.";
  const pis = somenteDigitos(f.pis_pasep_nit);
  if (pis && pis.length !== 11) e.pis_pasep_nit = "O PIS, o PASEP e o NIT têm 11 dígitos.";
  const titulo = somenteDigitos(f.titulo_eleitor);
  if (titulo && titulo.length !== 12) e.titulo_eleitor = "O título de eleitor tem 12 dígitos.";
  if (f.data_nascimento && (f.data_nascimento > hoje || f.data_nascimento < "1900-01-01")) e.data_nascimento = "Data de nascimento inválida.";
  if (f.rg_data_emissao && f.rg_data_emissao > hoje) e.rg_data_emissao = "A emissão não pode ser no futuro.";
  if (f.rg_data_emissao && f.data_nascimento && f.rg_data_emissao < f.data_nascimento) e.rg_data_emissao = "A emissão é antes do nascimento.";
  if (f.data_saida && f.data_entrada && f.data_saida < f.data_entrada) e.data_saida = "A saída é antes da entrada.";
  if (f.data_entrada && f.data_nascimento && f.data_entrada <= f.data_nascimento) e.data_entrada = "A entrada é antes do nascimento.";
  if (f.agencia.trim() && !/^[0-9]{1,6}(-?[0-9Xx])?$/.test(f.agencia.trim())) e.agencia = "Só os números da agência (e o dígito, se houver).";
  if (f.conta.trim() && !/^[0-9]{1,20}(-?[0-9Xx])?$/.test(f.conta.trim())) e.conta = "Só os números da conta (e o dígito).";
  if (!!f.pix_tipo !== !!f.pix_chave.trim()) e.pix_chave = "Informe o tipo e a chave PIX juntos.";
  if (f.vinculo_tipo === "pj" && f.pj_cnpj.trim() && !cnpjValidoAlfanumerico(f.pj_cnpj)) e.pj_cnpj = "CNPJ inválido — confira os dígitos.";
  if (f.vinculo_tipo === "socio" && f.participacao_capital.trim()) {
    const p = lerReais(f.participacao_capital);
    if (!Number.isFinite(p) || p < 0 || p > 100) e.participacao_capital = "Um percentual de 0 a 100.";
  }
  if (f.remuneracao_mensal.trim()) {
    const r = lerReais(f.remuneracao_mensal);
    if (!Number.isFinite(r) || r < 0) e.remuneracao_mensal = "Valor inválido.";
  }
  return e;
}

type Valor = string | number | boolean | null;

/**
 * O que vai para `salvar_cadastro_equipe_arkefit`. Sem ser sócio, só os campos
 * pessoais: o banco recusa (42501) quem mandar o vínculo. Os documentos vão
 * só com os dígitos, o vazio vai como nulo, e o que não vale para o vínculo
 * escolhido (o CNPJ de quem não é PJ, a participação de quem não é sócio, o
 * regime de bens de quem não é casado) vai como nulo.
 */
export function dadosParaSalvar(f: FormCadastro, { socio }: { socio: boolean }): Record<string, Valor> {
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  const digitos = (v: string) => (somenteDigitos(v) === "" ? null : somenteDigitos(v));
  const numero = (v: string) => (v.trim() === "" ? null : lerReais(v));
  const pessoais: Record<CampoPessoal, Valor> = {
    nome_completo: f.nome_completo.trim().replace(/\s+/g, " "),
    nome_social: t(f.nome_social),
    cpf: digitos(f.cpf),
    rg_numero: t(f.rg_numero),
    rg_orgao_emissor: t(f.rg_orgao_emissor),
    rg_uf: t(f.rg_uf),
    rg_data_emissao: t(f.rg_data_emissao),
    data_nascimento: t(f.data_nascimento),
    nacionalidade: t(f.nacionalidade),
    naturalidade_cidade: t(f.naturalidade_cidade),
    naturalidade_uf: t(f.naturalidade_uf),
    estado_civil: t(f.estado_civil),
    regime_bens: temRegimeDeBens(f.estado_civil) ? t(f.regime_bens) : null,
    profissao: t(f.profissao),
    nome_mae: t(f.nome_mae),
    nome_pai: t(f.nome_pai),
    telefone: digitos(f.telefone),
    email_contato: t(f.email_contato),
    endereco_cep: digitos(f.endereco_cep),
    endereco_logradouro: t(f.endereco_logradouro),
    endereco_numero: t(f.endereco_numero),
    endereco_complemento: t(f.endereco_complemento),
    endereco_bairro: t(f.endereco_bairro),
    endereco_cidade: t(f.endereco_cidade),
    endereco_uf: t(f.endereco_uf),
    pis_pasep_nit: digitos(f.pis_pasep_nit),
    ctps_numero: t(f.ctps_numero),
    ctps_serie: t(f.ctps_serie),
    titulo_eleitor: digitos(f.titulo_eleitor),
    banco: t(f.banco),
    agencia: t(f.agencia),
    conta: t(f.conta),
    conta_tipo: t(f.conta_tipo),
    pix_tipo: t(f.pix_tipo),
    pix_chave: t(f.pix_chave),
  };
  if (!socio) return pessoais;
  const vinculo = t(f.vinculo_tipo);
  const doSocio: Record<CampoDoSocio, Valor> = {
    vinculo_tipo: vinculo,
    cargo: t(f.cargo),
    data_entrada: t(f.data_entrada),
    data_saida: t(f.data_saida),
    pj_cnpj: vinculo === "pj" && t(f.pj_cnpj) ? f.pj_cnpj.toUpperCase().replace(/[./\s-]/g, "") : null,
    pj_razao_social: vinculo === "pj" ? t(f.pj_razao_social) : null,
    participacao_capital: vinculo === "socio" ? numero(f.participacao_capital) : null,
    socio_administrador: vinculo === "socio" ? f.socio_administrador : null,
    remuneracao_mensal: numero(f.remuneracao_mensal),
    observacoes: t(f.observacoes),
  };
  return { ...pessoais, ...doSocio };
}

// ── A planilha para a contabilidade ──────────────────────────────────────────

/**
 * As colunas, na ordem que a contabilidade espera: a identificação, a
 * filiação, o endereço (com o contato), os documentos, o vínculo e o
 * pagamento.
 */
export const COLUNAS_DA_FICHA: { secao: string; campo: CampoCadastro; rotulo: string }[] = [
  { secao: "Identificação", campo: "nome_completo", rotulo: "Nome completo" },
  { secao: "Identificação", campo: "nome_social", rotulo: "Nome social" },
  { secao: "Identificação", campo: "cpf", rotulo: "CPF" },
  { secao: "Identificação", campo: "rg_numero", rotulo: "RG" },
  { secao: "Identificação", campo: "rg_orgao_emissor", rotulo: "Órgão emissor" },
  { secao: "Identificação", campo: "rg_uf", rotulo: "UF do RG" },
  { secao: "Identificação", campo: "rg_data_emissao", rotulo: "Emissão do RG" },
  { secao: "Identificação", campo: "data_nascimento", rotulo: "Data de nascimento" },
  { secao: "Identificação", campo: "nacionalidade", rotulo: "Nacionalidade" },
  { secao: "Identificação", campo: "naturalidade_cidade", rotulo: "Naturalidade" },
  { secao: "Identificação", campo: "naturalidade_uf", rotulo: "UF da naturalidade" },
  { secao: "Identificação", campo: "estado_civil", rotulo: "Estado civil" },
  { secao: "Identificação", campo: "regime_bens", rotulo: "Regime de bens" },
  { secao: "Identificação", campo: "profissao", rotulo: "Profissão" },
  { secao: "Filiação", campo: "nome_mae", rotulo: "Nome da mãe" },
  { secao: "Filiação", campo: "nome_pai", rotulo: "Nome do pai" },
  { secao: "Endereço e contato", campo: "endereco_cep", rotulo: "CEP" },
  { secao: "Endereço e contato", campo: "endereco_logradouro", rotulo: "Logradouro" },
  { secao: "Endereço e contato", campo: "endereco_numero", rotulo: "Número" },
  { secao: "Endereço e contato", campo: "endereco_complemento", rotulo: "Complemento" },
  { secao: "Endereço e contato", campo: "endereco_bairro", rotulo: "Bairro" },
  { secao: "Endereço e contato", campo: "endereco_cidade", rotulo: "Cidade" },
  { secao: "Endereço e contato", campo: "endereco_uf", rotulo: "UF" },
  { secao: "Endereço e contato", campo: "telefone", rotulo: "Telefone" },
  { secao: "Endereço e contato", campo: "email_contato", rotulo: "E-mail de contato" },
  { secao: "Documentos", campo: "pis_pasep_nit", rotulo: "PIS/PASEP/NIT" },
  { secao: "Documentos", campo: "ctps_numero", rotulo: "CTPS (número)" },
  { secao: "Documentos", campo: "ctps_serie", rotulo: "CTPS (série)" },
  { secao: "Documentos", campo: "titulo_eleitor", rotulo: "Título de eleitor" },
  { secao: "Vínculo", campo: "vinculo_tipo", rotulo: "Vínculo" },
  { secao: "Vínculo", campo: "cargo", rotulo: "Cargo ou função" },
  { secao: "Vínculo", campo: "data_entrada", rotulo: "Entrada" },
  { secao: "Vínculo", campo: "data_saida", rotulo: "Saída" },
  { secao: "Vínculo", campo: "pj_cnpj", rotulo: "CNPJ (PJ)" },
  { secao: "Vínculo", campo: "pj_razao_social", rotulo: "Razão social (PJ)" },
  { secao: "Vínculo", campo: "participacao_capital", rotulo: "Participação no capital (%)" },
  { secao: "Vínculo", campo: "socio_administrador", rotulo: "Sócio administrador" },
  { secao: "Pagamento", campo: "remuneracao_mensal", rotulo: "Remuneração mensal (R$)" },
  { secao: "Pagamento", campo: "banco", rotulo: "Banco" },
  { secao: "Pagamento", campo: "agencia", rotulo: "Agência" },
  { secao: "Pagamento", campo: "conta", rotulo: "Conta" },
  { secao: "Pagamento", campo: "conta_tipo", rotulo: "Tipo de conta" },
  { secao: "Pagamento", campo: "pix_tipo", rotulo: "Tipo da chave PIX" },
  { secao: "Pagamento", campo: "pix_chave", rotulo: "Chave PIX" },
  { secao: "Observações", campo: "observacoes", rotulo: "Observações" },
];

const DATAS = new Set<CampoCadastro>(["rg_data_emissao", "data_nascimento", "data_entrada", "data_saida"]);

/** O valor de um campo na planilha: datas dd/mm/aaaa, documentos com a máscara, listas pelo nome, números como números. */
export function valorNaFicha(c: CadastroEquipe, campo: CampoCadastro): Celula {
  const v = c[campo];
  if (v === null || v === undefined || v === "") return "";
  if (DATAS.has(campo)) return dataBr(String(v));
  switch (campo) {
    case "cpf":
      return formatarCpf(String(v));
    case "endereco_cep":
      return formatarCep(String(v));
    case "telefone":
      return formatarTelefone(String(v));
    case "pis_pasep_nit":
      return formatarPis(String(v));
    case "pj_cnpj":
      return formatarCnpjAlfanumerico(String(v));
    case "estado_civil":
      return nomeDaOpcao(ESTADOS_CIVIS, String(v));
    case "regime_bens":
      return nomeDaOpcao(REGIMES_DE_BENS, String(v));
    case "vinculo_tipo":
      return nomeDaOpcao(VINCULOS, String(v));
    case "conta_tipo":
      return nomeDaOpcao(TIPOS_DE_CONTA, String(v));
    case "pix_tipo":
      return nomeDaOpcao(TIPOS_DE_PIX, String(v));
    case "socio_administrador":
      return v ? "Sim" : "Não";
    case "participacao_capital":
    case "remuneracao_mensal":
      return Number(v);
    default:
      return String(v);
  }
}

/** A ficha de uma pessoa, de cima para baixo: seção, campo e valor. */
export function linhasDaFicha(c: CadastroEquipe): Celula[][] {
  return [["Seção", "Campo", "Valor"], ...COLUNAS_DA_FICHA.map((col) => [col.secao, col.rotulo, valorNaFicha(c, col.campo)])];
}

/** O nome da aba de uma pessoa: o nome, curto e sem repetir. */
function nomeDaAba(nome: string, usados: Set<string>): string {
  const base = nome.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || "Pessoa";
  let n = base;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 26)} ${i}`;
  usados.add(n.toLowerCase());
  return n;
}

/**
 * As abas da planilha. Uma pessoa: a ficha dela. Mais de uma: a aba "Equipe",
 * com uma linha por pessoa e as colunas na ordem da contabilidade, e a ficha
 * de cada uma numa aba própria.
 */
export function abasDasFichas(cadastros: CadastroEquipe[]): Aba[] {
  if (cadastros.length === 1) return [{ nome: "Ficha", linhas: linhasDaFicha(cadastros[0]) }];
  const usados = new Set<string>(["equipe"]);
  return [
    {
      nome: "Equipe",
      linhas: [COLUNAS_DA_FICHA.map((c) => c.rotulo), ...cadastros.map((cad) => COLUNAS_DA_FICHA.map((c) => valorNaFicha(cad, c.campo)))],
    },
    ...cadastros.map((cad) => ({ nome: nomeDaAba(cad.nome_completo, usados), linhas: linhasDaFicha(cad) })),
  ];
}

/** "ficha-equipe-arkefit-ana-socia-2026-10-08.xlsx", sem acento nem espaço. */
export function nomeDoArquivoDaFicha(quem: string | null, hoje: string): string {
  const slug = (quem ?? "equipe")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return quem ? `ficha-equipe-arkefit-${slug}-${hoje}.xlsx` : `fichas-equipe-arkefit-${hoje}.xlsx`;
}

// ── Os documentos anexos ─────────────────────────────────────────────────────

export const TIPOS_DE_DOCUMENTO: Opcao[] = [
  { id: "rg_cnh", nome: "RG ou CNH" },
  { id: "cpf", nome: "CPF" },
  { id: "comprovante_residencia", nome: "Comprovante de residência" },
  { id: "contrato", nome: "Contrato" },
  { id: "outro", nome: "Outro" },
];

/** O mesmo limite e os mesmos tipos do bucket (20261430010000). */
export const TIPOS_DE_ARQUIVO = ["application/pdf", "image/jpeg", "image/png"];
export const LIMITE_DO_ARQUIVO = 10 * 1024 * 1024;

export function erroDoArquivo(arquivo: { size: number; type: string }): string | null {
  if (!TIPOS_DE_ARQUIVO.includes(arquivo.type)) return "Envie um PDF, JPG ou PNG.";
  if (arquivo.size > LIMITE_DO_ARQUIVO) return "O arquivo passa de 10 MB. Envie um PDF menor ou uma foto.";
  return null;
}

/**
 * O caminho no bucket: `<user_id>/<tipo>-<data>-<código>.<extensão>`. A pasta é
 * a pessoa (é por ela que a regra decide quem vê), e o nome guarda o tipo do
 * documento. O nome nunca se repete: não sobrescreve nada.
 */
export function caminhoDoDocumento(userId: string, tipo: string, extensao: string, hoje: string, codigo: string): string {
  const t = TIPOS_DE_DOCUMENTO.some((d) => d.id === tipo) ? tipo : "outro";
  return `${userId}/${t}-${hoje}-${codigo.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase()}.${extensao}`;
}

/** O tipo e a data de um documento, pelo nome do arquivo no bucket. */
export function lerNomeDoDocumento(nome: string): { tipo: string; data: string | null } {
  const tipo = TIPOS_DE_DOCUMENTO.filter((d) => nome.startsWith(`${d.id}-`)).sort((a, b) => b.id.length - a.id.length)[0];
  const data = /-(\d{4}-\d{2}-\d{2})-/.exec(nome)?.[1] ?? null;
  return { tipo: tipo?.nome ?? "Documento", data };
}

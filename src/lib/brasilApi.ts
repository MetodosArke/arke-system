/**
 * Preenchimento automático do cadastro da academia pela BrasilAPI — pública,
 * gratuita e sem chave. O gestor digita o CNPJ e recebe razão social, nome
 * fantasia, endereço e tipo de empresa; digita o CEP e o endereço se completa.
 * É o que tira o atrito da etapa mais cansativa: o cadastro que o Asaas exige
 * para abrir a conta.
 *
 * Falha da BrasilAPI nunca trava o cadastro: devolve `null` e o gestor digita.
 */

const soDigitos = (v: string) => v.replace(/\D/g, "");

/** CNPJ pelos dígitos verificadores (módulo 11). */
export function cnpjValido(valor: string): boolean {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split("").reduce((s, n, i) => s + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export function formatarCnpj(valor: string): string {
  const c = soDigitos(valor).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export function formatarCep(valor: string): string {
  const c = soDigitos(valor).slice(0, 8);
  return c.length > 5 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

export type TipoEmpresaAsaas = "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";

export const ROTULO_TIPO_EMPRESA: Record<TipoEmpresaAsaas, string> = {
  MEI: "MEI",
  LIMITED: "Sociedade limitada (LTDA)",
  INDIVIDUAL: "Empresário individual / EIRELI",
  ASSOCIATION: "Associação",
};

/**
 * Natureza jurídica da Receita → tipo de empresa do Asaas. MEI vem de um campo
 * à parte (opcao_pelo_mei), porque na natureza jurídica ele aparece como
 * empresário individual.
 */
export function tipoEmpresaDaNatureza(codigo: number | string | null | undefined, mei: boolean | null | undefined): TipoEmpresaAsaas {
  if (mei) return "MEI";
  const n = Number(codigo);
  if (n === 2135 || n === 2305 || n === 2313) return "INDIVIDUAL";
  if (n >= 3000 && n < 4000) return "ASSOCIATION";
  return "LIMITED";
}

export type EnderecoAutomatico = {
  cep: string;
  logradouro: string;
  numero?: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export type DadosCnpj = EnderecoAutomatico & {
  razaoSocial: string;
  nomeFantasia: string;
  tipoEmpresa: TipoEmpresaAsaas;
  telefone?: string;
  email?: string;
};

type RespostaCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  cep?: string;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  ddd_telefone_1?: string;
  email?: string | null;
  codigo_natureza_juridica?: number;
  opcao_pelo_mei?: boolean | null;
};

const titulo = (v?: string) =>
  (v ?? "")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase())
    .trim();

export function interpretarCnpj(r: RespostaCnpj): DadosCnpj {
  const tipoLogradouro = r.descricao_tipo_de_logradouro ? `${titulo(r.descricao_tipo_de_logradouro)} ` : "";
  return {
    razaoSocial: (r.razao_social ?? "").trim(),
    nomeFantasia: titulo(r.nome_fantasia) || titulo(r.razao_social),
    tipoEmpresa: tipoEmpresaDaNatureza(r.codigo_natureza_juridica, r.opcao_pelo_mei),
    cep: formatarCep(r.cep ?? ""),
    logradouro: `${tipoLogradouro}${titulo(r.logradouro)}`.trim(),
    numero: r.numero && r.numero !== "S/N" ? r.numero : undefined,
    complemento: r.complemento ? titulo(r.complemento) : undefined,
    bairro: titulo(r.bairro),
    cidade: titulo(r.municipio),
    uf: (r.uf ?? "").toUpperCase(),
    telefone: r.ddd_telefone_1 ? soDigitos(r.ddd_telefone_1) : undefined,
    email: r.email ? r.email.toLowerCase() : undefined,
  };
}

async function buscar<T>(url: string): Promise<T | null> {
  // AbortController em vez de AbortSignal.timeout: este não existe em
  // navegadores de celular mais antigos, que é justamente o da recepção.
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 8000);
  try {
    const resp = await fetch(url, { signal: controle.signal });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function buscarCnpj(cnpj: string): Promise<DadosCnpj | null> {
  const c = soDigitos(cnpj);
  if (!cnpjValido(c)) return null;
  const r = await buscar<RespostaCnpj>(`https://brasilapi.com.br/api/cnpj/v1/${c}`);
  return r ? interpretarCnpj(r) : null;
}

export async function buscarCep(cep: string): Promise<EnderecoAutomatico | null> {
  const c = soDigitos(cep);
  if (c.length !== 8) return null;
  const r = await buscar<{ cep?: string; state?: string; city?: string; neighborhood?: string; street?: string }>(
    `https://brasilapi.com.br/api/cep/v2/${c}`
  );
  if (!r) return null;
  return {
    cep: formatarCep(r.cep ?? c),
    logradouro: r.street ?? "",
    bairro: r.neighborhood ?? "",
    cidade: r.city ?? "",
    uf: (r.state ?? "").toUpperCase(),
  };
}

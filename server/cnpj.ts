export type CnpjLookup = {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  situacao?: string;
};

export async function lookupCnpj(cnpj: string): Promise<CnpjLookup> {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) throw new Error("Informe um CNPJ válido com 14 dígitos.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("CNPJ não encontrado ou serviço temporariamente indisponível.");
    const data = await response.json() as CnpjLookup;
    return { ...data, cnpj: digits };
  } catch (error) {
    if (error instanceof Error && error.message.includes("CNPJ")) throw error;
    throw new Error("Não foi possível consultar o CNPJ agora. Você pode preencher os dados manualmente.");
  } finally {
    clearTimeout(timeout);
  }
}

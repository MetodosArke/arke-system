import { afterEach, describe, expect, it, vi } from "vitest";
import { buscarCep, buscarCnpj, cnpjValido, formatarCep, formatarCnpj, interpretarCnpj, tipoEmpresaDaNatureza } from "./brasilApi";

describe("cnpjValido", () => {
  it("aceita CNPJ com dígitos certos, com ou sem máscara", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
  });
  it("recusa dígito errado, tamanho errado e sequência repetida", () => {
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
    expect(cnpjValido("1122233300018")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });
});

describe("máscaras", () => {
  it("formata CNPJ e CEP", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarCep("01310100")).toBe("01310-100");
  });
});

describe("tipoEmpresaDaNatureza", () => {
  it("MEI vem da opção pelo MEI, não da natureza", () => {
    expect(tipoEmpresaDaNatureza(2135, true)).toBe("MEI");
  });
  it("mapeia as naturezas comuns", () => {
    expect(tipoEmpresaDaNatureza(2062, false)).toBe("LIMITED");
    expect(tipoEmpresaDaNatureza(2135, false)).toBe("INDIVIDUAL");
    expect(tipoEmpresaDaNatureza(3999, null)).toBe("ASSOCIATION");
    expect(tipoEmpresaDaNatureza(undefined, undefined)).toBe("LIMITED");
  });
});

describe("interpretarCnpj", () => {
  it("monta o cadastro a partir da resposta da BrasilAPI", () => {
    const d = interpretarCnpj({
      razao_social: "ACADEMIA TIETE LTDA",
      nome_fantasia: "TIETE FITNESS",
      cep: "03001000",
      descricao_tipo_de_logradouro: "RUA",
      logradouro: "ETTORE ANDREAZZA",
      numero: "260",
      bairro: "TATUAPE",
      municipio: "SAO PAULO",
      uf: "sp",
      ddd_telefone_1: "1133334444",
      codigo_natureza_juridica: 2062,
      opcao_pelo_mei: false,
    });
    expect(d).toMatchObject({
      razaoSocial: "ACADEMIA TIETE LTDA",
      nomeFantasia: "Tiete Fitness",
      tipoEmpresa: "LIMITED",
      cep: "03001-000",
      logradouro: "Rua Ettore Andreazza",
      numero: "260",
      bairro: "Tatuape",
      cidade: "Sao Paulo",
      uf: "SP",
      telefone: "1133334444",
    });
  });
  it("sem número (S/N) deixa o campo para o gestor", () => {
    expect(interpretarCnpj({ numero: "S/N" }).numero).toBeUndefined();
  });
});

describe("busca", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("CNPJ inválido nem chama a API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await buscarCnpj("123")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("API fora do ar devolve nulo, não quebra o cadastro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("rede")));
    expect(await buscarCnpj("11222333000181")).toBeNull();
    expect(await buscarCep("01310100")).toBeNull();
  });

  it("CEP completa o endereço", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ cep: "01310100", state: "SP", city: "São Paulo", neighborhood: "Bela Vista", street: "Avenida Paulista" }),
      })
    );
    expect(await buscarCep("01310-100")).toEqual({
      cep: "01310-100",
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    });
  });
});

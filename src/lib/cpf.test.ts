import { describe, it, expect } from "vitest";
import { validarCpf, formatarCpf, erroCpf, somenteDigitos, erroCpfObrigatorio } from "./cpf";

// CPFs válidos gerados pelo próprio algoritmo do módulo 11 — não são de
// pessoas reais, só combinações que fecham o dígito verificador.
const VALIDOS = ["52998224725", "11144477735", "390.533.447-05"];

describe("validarCpf", () => {
  it.each(VALIDOS)("aceita CPF com dígito verificador correto: %s", (cpf) => {
    expect(validarCpf(cpf)).toBe(true);
  });

  it("rejeita CPF com um dígito trocado", () => {
    // O caso que mais aparece em digitação e em planilha exportada.
    expect(validarCpf("52998224725")).toBe(true);
    expect(validarCpf("52998224726")).toBe(false);
  });

  it("rejeita sequências repetidas, que passam no módulo 11 por acidente", () => {
    // São o preenchimento improvisado mais comum quando o campo é obrigatório
    // e quem cadastra não tem o documento à mão.
    for (const repetido of ["00000000000", "11111111111", "99999999999"]) {
      expect(validarCpf(repetido)).toBe(false);
    }
  });

  it("rejeita comprimento errado", () => {
    expect(validarCpf("123")).toBe(false);
    expect(validarCpf("5299822472")).toBe(false);
    expect(validarCpf("529982247251")).toBe(false);
  });

  it("rejeita vazio, nulo e indefinido sem estourar", () => {
    expect(validarCpf("")).toBe(false);
    expect(validarCpf(null)).toBe(false);
    expect(validarCpf(undefined)).toBe(false);
  });

  it("aceita CPF pontuado, como vem de planilha", () => {
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarCpf(" 529 982 247 25 ")).toBe(true);
  });
});

describe("somenteDigitos", () => {
  it("remove pontuação e espaços", () => {
    expect(somenteDigitos("529.982.247-25")).toBe("52998224725");
  });
});

describe("formatarCpf", () => {
  it("formata para exibição", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });

  it("devolve o original quando não dá para formatar, em vez de mascarar o problema", () => {
    expect(formatarCpf("123")).toBe("123");
    expect(formatarCpf("")).toBe("");
  });
});

describe("erroCpf", () => {
  it("não reclama de campo vazio — isso é decisão de quem chama", () => {
    expect(erroCpf("")).toBeNull();
    expect(erroCpf(null)).toBeNull();
  });

  it("separa comprimento errado de dígito errado", () => {
    // A distinção importa na importação: uma aponta para a planilha, a
    // outra aponta para o documento do aluno.
    expect(erroCpf("123")).toContain("11 dígitos");
    expect(erroCpf("52998224726")).toContain("inválido");
  });

  it("não reclama de CPF correto", () => {
    expect(erroCpf("529.982.247-25")).toBeNull();
  });
});

describe("erroCpfObrigatorio", () => {
  it("exige o campo — é o que separa matrícula de cadastro solto", () => {
    // A matrícula gera cobrança, e o gateway não emite cobrança sem CPF.
    expect(erroCpfObrigatorio("")).toContain("obrigatório");
    expect(erroCpfObrigatorio(null)).toContain("obrigatório");
    expect(erroCpfObrigatorio("   ")).toContain("obrigatório");
  });

  it("no resto, vale a mesma régua de erroCpf", () => {
    expect(erroCpfObrigatorio("123")).toContain("11 dígitos");
    expect(erroCpfObrigatorio("52998224726")).toContain("inválido");
    expect(erroCpfObrigatorio("529.982.247-25")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  luhnValido,
  detectarBandeira,
  mascararNumero,
  finalDoCartao,
  normalizarValidade,
  cvvValido,
  erroNoCartao,
  type DadosCartao,
  type DadosTitular,
} from "./cartao";

// Números de teste públicos das bandeiras (passam no Luhn, não são cartões reais).
const VISA = "4111 1111 1111 1111";
const MASTER = "5555 5555 5555 4444";
const AMEX = "3782 822463 10005";
const HOJE = new Date(2026, 8, 21); // 21/09/2026

const cartaoOk: DadosCartao = { titular: "MARIA SILVA", numero: VISA, mes: "12", ano: "2030", cvv: "123" };
const titularOk: DadosTitular = {
  nome: "Maria Silva",
  email: "maria@exemplo.com",
  cpf: "529.982.247-25",
  cep: "01310-100",
  numeroEndereco: "1000",
  telefone: "(11) 98765-4321",
};

describe("luhnValido", () => {
  it("aceita os números de teste das bandeiras", () => {
    expect(luhnValido(VISA)).toBe(true);
    expect(luhnValido(MASTER)).toBe(true);
    expect(luhnValido(AMEX)).toBe(true);
  });

  it("recusa um dígito trocado", () => {
    expect(luhnValido("4111 1111 1111 1112")).toBe(false);
  });

  it("recusa comprimento fora do padrão", () => {
    expect(luhnValido("4111")).toBe(false);
    expect(luhnValido("4".repeat(20))).toBe(false);
  });
});

describe("detectarBandeira", () => {
  it("reconhece as principais", () => {
    expect(detectarBandeira(VISA)).toBe("visa");
    expect(detectarBandeira(MASTER)).toBe("mastercard");
    expect(detectarBandeira("2221000000000009")).toBe("mastercard");
    expect(detectarBandeira(AMEX)).toBe("amex");
    expect(detectarBandeira("6062820000000000")).toBe("hipercard");
  });

  it("não confunde Elo que começa com 4 ou 5 com Visa ou Master", () => {
    // É o motivo de Elo ser testada antes: estes prefixos seriam Visa/Master.
    expect(detectarBandeira("4011780000000000")).toBe("elo");
    expect(detectarBandeira("5067000000000000")).toBe("elo");
    expect(detectarBandeira("6362970000000000")).toBe("elo");
  });

  it("devolve 'outra' quando não reconhece, sem inventar", () => {
    expect(detectarBandeira("9999")).toBe("outra");
    expect(detectarBandeira("")).toBe("outra");
  });
});

describe("mascararNumero e finalDoCartao", () => {
  it("agrupa de 4 em 4, e Amex em 4-6-5", () => {
    expect(mascararNumero("4111111111111111")).toBe("4111 1111 1111 1111");
    expect(mascararNumero("378282246310005")).toBe("3782 822463 10005");
  });

  it("guarda só os 4 últimos dígitos — nunca o número", () => {
    expect(finalDoCartao(VISA)).toBe("1111");
    expect(finalDoCartao(VISA)).toHaveLength(4);
  });
});

describe("normalizarValidade", () => {
  it("formata como o Asaas espera (mês com 2 dígitos, ano com 4)", () => {
    expect(normalizarValidade("3", "30", HOJE)).toEqual({ mes: "03", ano: "2030" });
  });

  it("vale até o último dia do mês impresso", () => {
    expect(normalizarValidade("09", "2026", HOJE)).not.toBeNull();
    expect(normalizarValidade("08", "2026", HOJE)).toBeNull();
  });

  it("recusa mês impossível", () => {
    expect(normalizarValidade("13", "2030", HOJE)).toBeNull();
    expect(normalizarValidade("0", "2030", HOJE)).toBeNull();
  });
});

describe("cvvValido", () => {
  it("Amex exige 4 dígitos; as demais aceitam 3", () => {
    expect(cvvValido("1234", "amex")).toBe(true);
    expect(cvvValido("123", "amex")).toBe(false);
    expect(cvvValido("123", "visa")).toBe(true);
  });
});

describe("erroNoCartao", () => {
  it("aprova um cadastro completo", () => {
    expect(erroNoCartao(cartaoOk, titularOk, HOJE)).toBeNull();
  });

  it("aponta o primeiro problema em linguagem de quem digita", () => {
    expect(erroNoCartao({ ...cartaoOk, numero: "4111 1111 1111 1112" }, titularOk, HOJE)).toMatch(/Número do cartão/);
    expect(erroNoCartao({ ...cartaoOk, ano: "2020" }, titularOk, HOJE)).toMatch(/vencida/);
    expect(erroNoCartao(cartaoOk, { ...titularOk, cpf: "111.111.111-11" }, HOJE)).toMatch(/CPF/);
    expect(erroNoCartao(cartaoOk, { ...titularOk, cep: "0131" }, HOJE)).toMatch(/CEP/);
    expect(erroNoCartao(cartaoOk, { ...titularOk, telefone: "98765" }, HOJE)).toMatch(/Telefone/);
  });
});

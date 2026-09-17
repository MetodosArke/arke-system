import { describe, expect, it } from "vitest";
import { parseNumber } from "./importacao";

describe("parseNumber", () => {
  it("interpreta padrão BR com centavos", () => {
    expect(parseNumber("149,90")).toBe(149.9);
    expect(parseNumber("1.234,56")).toBe(1234.56);
  });

  it("interpreta valor vindo de célula numérica de XLSX (decimal com ponto)", () => {
    expect(parseNumber("149.9")).toBe(149.9);
    expect(parseNumber("149.90")).toBe(149.9);
    expect(parseNumber("1234.5")).toBe(1234.5);
  });

  it("interpreta padrão US com centavos e milhar", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
  });

  it("trata múltiplos pontos como agrupamento de milhar", () => {
    expect(parseNumber("1.234.567")).toBe(1234567);
  });

  it("aceita prefixo de moeda e espaços", () => {
    expect(parseNumber("R$ 149,90")).toBe(149.9);
  });

  it("retorna null para valor inválido", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
});

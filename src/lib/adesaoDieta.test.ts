import { describe, it, expect } from "vitest";
import {
  faixaDeAdesao,
  gravarGuiaDietaAberto,
  guiaDietaAberto,
  marcacoesDoPlano,
  percentualAdesao,
  respondidas,
  type RefeicaoPlano,
} from "./adesaoDieta";

const PLANO: RefeicaoPlano[] = [
  { ordem: 1, nome: "Café da manhã" },
  { ordem: 2, nome: "Almoço" },
  { ordem: 3, nome: "Lanche" },
  { ordem: 4, nome: "Jantar" },
];

describe("adesão à dieta por refeição", () => {
  it("percentual é cumpridas sobre o total do plano", () => {
    expect(percentualAdesao(PLANO, { "1": true, "2": true, "3": false, "4": true })).toBe(75);
  });

  it("refeição sem resposta conta como não cumprida", () => {
    expect(percentualAdesao(PLANO, { "1": true })).toBe(25);
    expect(respondidas(PLANO, { "1": true })).toBe(1);
  });

  it("tudo cumprido é 100, nada respondido é 0", () => {
    expect(percentualAdesao(PLANO, { "1": true, "2": true, "3": true, "4": true })).toBe(100);
    expect(percentualAdesao(PLANO, {})).toBe(0);
    expect(percentualAdesao(PLANO, null)).toBe(0);
  });

  it("dieta sem refeições (só PDF) não tem percentual automático", () => {
    expect(percentualAdesao([], { "1": true })).toBeNull();
  });

  it("marcação de refeição que não está no plano é descartada", () => {
    // Ex.: marcação antiga de uma versão anterior da dieta com 5 refeições.
    expect(marcacoesDoPlano(PLANO, { "1": true, "5": true })).toEqual({ "1": true });
    expect(percentualAdesao(PLANO, { "1": true, "5": true })).toBe(25);
  });
});

describe("faixa do calendário de adesão", () => {
  it("corta em 80, 50 e 30", () => {
    expect(faixaDeAdesao(100)).toBe("otima");
    expect(faixaDeAdesao(80)).toBe("otima");
    expect(faixaDeAdesao(79)).toBe("boa");
    expect(faixaDeAdesao(50)).toBe("boa");
    expect(faixaDeAdesao(49)).toBe("atencao");
    expect(faixaDeAdesao(30)).toBe("atencao");
    expect(faixaDeAdesao(29)).toBe("baixa");
    expect(faixaDeAdesao(0)).toBe("baixa");
  });
});

describe("guia de alimentos recolhível", () => {
  const armazem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("abre por padrão, para o check continuar a um toque", () => {
    expect(guiaDietaAberto(armazem())).toBe(true);
    expect(guiaDietaAberto(null)).toBe(true);
  });

  it("lembra a escolha do aluno", () => {
    const a = armazem();
    gravarGuiaDietaAberto(a, false);
    expect(guiaDietaAberto(a)).toBe(false);
    gravarGuiaDietaAberto(a, true);
    expect(guiaDietaAberto(a)).toBe(true);
  });

  it("sem armazenamento (aba privada), não quebra e abre", () => {
    const quebrado = {
      getItem: (): string | null => {
        throw new Error("SecurityError");
      },
      setItem: (): void => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => gravarGuiaDietaAberto(quebrado, false)).not.toThrow();
    expect(guiaDietaAberto(quebrado)).toBe(true);
  });
});

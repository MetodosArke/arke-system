import { afterEach, describe, expect, it, vi } from "vitest";
import { acessoPelaSituacao, planoDoAluno, prioridadeDoPlano, situacaoDoTexto, temNutricaoNoPlano, vendaMetodoArkeLiberada } from "./planoAluno";

describe("planoDoAluno", () => {
  it("quem não está no Método é Free, mesmo com nível gravado", () => {
    expect(planoDoAluno({ metodo_arke_status: "sem_adesao", nivel_atacado: "elite" })).toBe("free");
    expect(planoDoAluno({ metodo_arke_status: "cancelado", nivel_atacado: "integrado" })).toBe("free");
    expect(planoDoAluno({ metodo_arke_status: "sem_adesao", nivel_atacado: null })).toBe("free");
  });

  it("Método ativo vale o nível", () => {
    expect(planoDoAluno({ metodo_arke_status: "ativo", nivel_atacado: "integrado" })).toBe("integrado");
    expect(planoDoAluno({ metodo_arke_status: "ativo", nivel_atacado: "elite" })).toBe("elite");
  });

  it("o Essencial antigo conta como Free", () => {
    expect(planoDoAluno({ metodo_arke_status: "ativo", nivel_atacado: "essencial" })).toBe("free");
  });
});

describe("prioridade e nutrição", () => {
  it("Elite fura a fila, Integrado vem antes do Free", () => {
    expect(prioridadeDoPlano("elite")).toBeGreaterThan(prioridadeDoPlano("integrado"));
    expect(prioridadeDoPlano("integrado")).toBeGreaterThan(prioridadeDoPlano("free"));
    expect(prioridadeDoPlano(undefined)).toBe(prioridadeDoPlano("free"));
  });

  it("nutrição é do Método", () => {
    expect(temNutricaoNoPlano("free")).toBe(false);
    expect(temNutricaoNoPlano("integrado")).toBe(true);
    expect(temNutricaoNoPlano("elite")).toBe(true);
  });
});

describe("situacaoDoTexto", () => {
  it.each([
    ["", "em_dia"],
    ["Ativo", "em_dia"],
    ["EM DIA", "em_dia"],
    ["Adimplente", "em_dia"],
    ["Inadimplente", "inadimplente"],
    ["Atrasado", "inadimplente"],
    ["Em débito", "inadimplente"],
    ["Bloqueado", "inadimplente"],
    ["Pausado", "pausado"],
    ["Trancado", "pausado"],
    ["Congelado", "pausado"],
    ["Férias", "pausado"],
  ])("%s → %s", (texto, esperado) => {
    expect(situacaoDoTexto(texto)).toBe(esperado);
  });

  it("não adivinha: texto desconhecido volta nulo", () => {
    expect(situacaoDoTexto("xyz")).toBeNull();
    expect(situacaoDoTexto("Inativo")).toBeNull();
    expect(situacaoDoTexto("Cancelado")).toBeNull();
  });
});

describe("acessoPelaSituacao", () => {
  const agora = new Date("2026-09-22T12:00:00Z");
  it("em dia entra; pausado sai na hora", () => {
    expect(acessoPelaSituacao("em_dia", null, agora)).toEqual({ liberado: true, diasRestantes: null });
    expect(acessoPelaSituacao("pausado", "2026-09-22T11:00:00Z", agora).liberado).toBe(false);
  });
  it("inadimplente usa por 5 dias corridos, com a contagem regressiva", () => {
    expect(acessoPelaSituacao("inadimplente", "2026-09-22T11:00:00Z", agora)).toEqual({ liberado: true, diasRestantes: 5 });
    expect(acessoPelaSituacao("inadimplente", "2026-09-18T13:00:00Z", agora)).toEqual({ liberado: true, diasRestantes: 2 });
    expect(acessoPelaSituacao("inadimplente", "2026-09-17T11:00:00Z", agora).liberado).toBe(false);
  });
});

describe("vendaMetodoArkeLiberada", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("desligada sem a variável", () => {
    vi.stubEnv("VITE_METODO_ARKE_VENDA", "");
    expect(vendaMetodoArkeLiberada()).toBe(false);
  });

  it("liga só com true", () => {
    vi.stubEnv("VITE_METODO_ARKE_VENDA", "true");
    expect(vendaMetodoArkeLiberada()).toBe(true);
  });
});

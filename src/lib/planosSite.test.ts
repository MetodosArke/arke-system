import { describe, it, expect } from "vitest";
import { cartoesDosPlanos, precoDoSite } from "./planosSite";

// O que planos_b2b_site() devolve hoje, com o Enterprise com e sem teto.
const TABELA = {
  planos: [
    { plano: "growth", valor_mensal: 390, limite_alunos: 300 },
    { plano: "enterprise", valor_mensal: 790, limite_alunos: null },
    { plano: "redes", valor_mensal: 1290, limite_alunos: null },
    { plano: "custom", valor_mensal: null, limite_alunos: null },
  ],
  implantacao: "500.0000",
};

describe("planos na página de vendas", () => {
  it("preço sem centavos quando é redondo, com ponto de milhar e vírgula", () => {
    expect(precoDoSite(390)?.replace(/\s/g, " ")).toBe("R$ 390");
    expect(precoDoSite("1290")?.replace(/\s/g, " ")).toBe("R$ 1.290");
    expect(precoDoSite(99.9)?.replace(/\s/g, " ")).toBe("R$ 99,90");
    expect(precoDoSite(null)).toBeNull();
    expect(precoDoSite(0)).toBeNull();
    expect(precoDoSite("")).toBeNull();
  });

  it("monta os quatro planos na ordem do banco, com o Custom sob consulta", () => {
    const { planos, implantacao } = cartoesDosPlanos(TABELA);
    expect(planos.map((p) => p.nome)).toEqual(["Growth", "Enterprise", "Redes", "Custom"]);
    expect(planos.map((p) => p.preco?.replace(/\s/g, " ") ?? null)).toEqual(["R$ 390", "R$ 790", "R$ 1.290", null]);
    expect(implantacao?.replace(/\s/g, " ")).toBe("R$ 500");
    expect(planos[0].publico).toBe("Uma unidade, até 300 alunos ativos");
    expect(planos[2].publico).toBe("Até 3 unidades, cobrado na unidade principal");
  });

  it("o Enterprise começa onde o Growth termina, com ou sem teto", () => {
    expect(cartoesDosPlanos(TABELA).planos[1].publico).toBe("Uma unidade, a partir de 301 alunos ativos, sem limite");
    const comTeto = { ...TABELA, planos: TABELA.planos.map((p) => (p.plano === "enterprise" ? { ...p, limite_alunos: 1500 } : p)) };
    expect(cartoesDosPlanos(comTeto).planos[1].publico).toBe("Uma unidade, de 301 a 1.500 alunos ativos");
    // Mudar o limite do Growth em Configurações muda as duas frases.
    const growth400 = { ...TABELA, planos: TABELA.planos.map((p) => (p.plano === "growth" ? { ...p, limite_alunos: 400 } : p)) };
    expect(cartoesDosPlanos(growth400).planos.map((p) => p.publico).slice(0, 2)).toEqual([
      "Uma unidade, até 400 alunos ativos",
      "Uma unidade, a partir de 401 alunos ativos, sem limite",
    ]);
  });

  it("plano que não está à venda não aparece, e resposta vazia não quebra", () => {
    const comAutonomo = { ...TABELA, planos: [...TABELA.planos, { plano: "autonomo", valor_mensal: null, limite_alunos: null }] };
    expect(cartoesDosPlanos(comAutonomo).planos).toHaveLength(4);
    expect(cartoesDosPlanos(null)).toEqual({ planos: [], implantacao: null });
    expect(cartoesDosPlanos({ planos: null, implantacao: null })).toEqual({ planos: [], implantacao: null });
  });
});

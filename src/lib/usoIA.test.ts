import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { custoEmDolar, nomeDoAgente, taxaDeRecusa } from "./usoIA";
import { espelhoRecusado } from "../../supabase/functions/agente-comercial/fluxo";

describe("medidor de uso das IAs: as contas da tela", () => {
  it("taxa de recusa em %, e nada sem chamada", () => {
    expect(taxaDeRecusa({ chamadas: 10, recusadas_trava: 2 })).toBe(20);
    expect(taxaDeRecusa({ chamadas: 3, recusadas_trava: 1 })).toBe(33);
    expect(taxaDeRecusa({ chamadas: 0, recusadas_trava: 0 })).toBeNull();
  });

  it("custo em dólar, com o centavo que não aparece dito", () => {
    expect(custoEmDolar(0)).toBe("US$ 0");
    expect(custoEmDolar(0.004)).toBe("menos de US$ 0,01");
    expect(custoEmDolar(1.5)).toBe("US$ 1,50");
  });

  it("nome de cada IA, e o código para a que não é conhecida", () => {
    expect(nomeDoAgente("leticia")).toBe("Letícia (comercial)");
    expect(nomeDoAgente("outra")).toBe("outra");
  });
});

describe("a trava da Letícia, vista pelo medidor", () => {
  it("espelho com número é recusa; espelho bom ou vazio não é", () => {
    expect(espelhoRecusado(`{"categoria":"inadimplencia","espelho":"Com o nosso plano a inadimplência cai 40% no primeiro mês."}`)).toBe(true);
    expect(espelhoRecusado(`{"categoria":"evasao","espelho":"Ver aluno sumir sem ninguém perceber a tempo é frustrante para quem cuida de uma academia."}`)).toBe(false);
    expect(espelhoRecusado(`{"categoria":"evasao","espelho":""}`)).toBe(false);
    expect(espelhoRecusado("sem json")).toBe(false);
  });
});

describe("toda IA registra o uso", () => {
  // O Sentinela segue congelado: só correção de defeito aprovada entra nele.
  const CONGELADAS = new Set(["sentinela-anamnese", "mentor-sugerir-resposta"]);
  const RAIZ = join(__dirname, "..", "..", "supabase", "functions");

  it("quem chama o modelo grava em ia_chamadas, fora o Sentinela", () => {
    const semMedidor = readdirSync(RAIZ, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !CONGELADAS.has(d.name))
      .filter((d) => existsSync(join(RAIZ, d.name, "index.ts")))
      .filter((d) => {
        const fonte = readFileSync(join(RAIZ, d.name, "index.ts"), "utf8");
        return /\b(conversarComIA|consultarAssistente|consultarVigia)\(/.test(fonte) && !fonte.includes("registrarUsoIA(");
      })
      .map((d) => d.name);
    expect(semMedidor).toEqual([]);
  });

  it("as funções congeladas existem (senão saem da lista)", () => {
    for (const nome of CONGELADAS) expect(existsSync(join(RAIZ, nome, "index.ts")), nome).toBe(true);
  });
});

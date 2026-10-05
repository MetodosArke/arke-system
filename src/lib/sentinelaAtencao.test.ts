import { describe, it, expect } from "vitest";
import { lerAtencao } from "../../supabase/functions/sentinela-anamnese/atencao";

/**
 * A linha final do resumo da anamnese diz se o aluno exige cuidado. Até
 * 04/10/2026, "ATENÇÃO: SIM" (com acento) e a linha esquecida davam "não
 * exige": um aluno com lesão declarada aparecia sem cuidado especial.
 */
describe("Sentinela: a linha de atenção", () => {
  it("lê SIM e NÃO, com e sem acento, em qualquer caixa", () => {
    expect(lerAtencao("Resumo.\nATENCAO: SIM").exigeAtencao).toBe(true);
    expect(lerAtencao("Resumo.\nATENÇÃO: SIM").exigeAtencao).toBe(true);
    expect(lerAtencao("Resumo.\nATENCAO: NAO").exigeAtencao).toBe(false);
    expect(lerAtencao("Resumo.\nATENÇÃO: NÃO").exigeAtencao).toBe(false);
    expect(lerAtencao("Resumo.\natenção: não\n").exigeAtencao).toBe(false);
  });

  it("tira a linha do resumo", () => {
    expect(lerAtencao("Cirurgia de menisco em 2022.\nATENÇÃO: SIM\n").resumo).toBe("Cirurgia de menisco em 2022.");
  });

  it("sem a linha, pede atenção e guarda o texto inteiro", () => {
    const r = lerAtencao("Declarou dor lombar e uso de losartana.");
    expect(r.exigeAtencao).toBe(true);
    expect(r.resumo).toBe("Declarou dor lombar e uso de losartana.");
  });

  it("a palavra no meio do texto não conta como a linha final", () => {
    expect(lerAtencao("ATENCAO: NAO aparece aqui, mas o aluno declarou cirurgia.").exigeAtencao).toBe(true);
  });
});

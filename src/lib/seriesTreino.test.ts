import { describe, it, expect } from "vitest";
import { divisoesDoTreino, paraGravar, resumoSeries, seriesDoExercicio, seriesUniformes, sequenciaDoTreino } from "./seriesTreino";

describe("séries individuais", () => {
  it("ficha antiga, sem detalhe, vira séries iguais", () => {
    expect(seriesDoExercicio({ series: 3, repeticoes: "12", descanso_seg: 60 })).toEqual([
      { reps: "12", descanso_seg: 60, tecnica: null },
      { reps: "12", descanso_seg: 60, tecnica: null },
      { reps: "12", descanso_seg: 60, tecnica: null },
    ]);
  });

  it("com detalhe, cada série tem o seu", () => {
    const detalhe = [
      { reps: "12", descanso_seg: 60 },
      { reps: "10", descanso_seg: 60 },
      { reps: "8", descanso_seg: 90, tecnica: "drop_set" },
    ];
    expect(seriesDoExercicio({ series: 3, repeticoes: "12-10-8", descanso_seg: 60, series_detalhe: detalhe })[2]).toEqual({
      reps: "8",
      descanso_seg: 90,
      tecnica: "drop_set",
    });
  });

  it("detalhe malformado cai no resumo, sem quebrar a tela do aluno", () => {
    expect(seriesDoExercicio({ series: 2, repeticoes: "15", descanso_seg: 45, series_detalhe: [{ reps: 15 }] })).toHaveLength(2);
  });

  it("resumo junta repetições diferentes com hífen", () => {
    expect(resumoSeries([{ reps: "12", descanso_seg: 60 }, { reps: "10", descanso_seg: 60 }, { reps: "8", descanso_seg: 90 }])).toEqual({
      series: 3,
      repeticoes: "12-10-8",
      descanso_seg: 60,
    });
    expect(resumoSeries([{ reps: "12", descanso_seg: 60 }, { reps: "12", descanso_seg: 60 }]).repeticoes).toBe("12");
  });

  it("só grava detalhe quando as séries diferem", () => {
    const iguais = [{ reps: "12", descanso_seg: 60 }, { reps: "12", descanso_seg: 60 }];
    expect(seriesUniformes(iguais)).toBe(true);
    expect(paraGravar(iguais).series_detalhe).toBeNull();
    const drop = [{ reps: "12", descanso_seg: 60 }, { reps: "12", descanso_seg: 60, tecnica: "drop_set" as const }];
    expect(paraGravar(drop).series_detalhe).toEqual(drop);
  });
});

describe("divisões do treino", () => {
  it("em ordem, e ficha antiga sem divisão é A", () => {
    expect(divisoesDoTreino([{ divisao: "B" }, { divisao: "A" }, { divisao: "B" }, {}])).toEqual(["A", "B"]);
  });
});

describe("sequência sugerida das divisões", () => {
  const abc = ["A", "B", "C"];

  it("depois da última concluída vem a seguinte", () => {
    expect(sequenciaDoTreino(abc, "A")).toEqual({ ultimo: "A", proximo: "B" });
    expect(sequenciaDoTreino(abc, "B")).toEqual({ ultimo: "B", proximo: "C" });
  });

  it("depois da última da lista, volta para a primeira", () => {
    expect(sequenciaDoTreino(abc, "C")).toEqual({ ultimo: "C", proximo: "A" });
  });

  it("sem treino concluído, sugere a primeira e não marca último", () => {
    expect(sequenciaDoTreino(abc, null)).toEqual({ ultimo: null, proximo: "A" });
    expect(sequenciaDoTreino(abc, undefined)).toEqual({ ultimo: null, proximo: "A" });
  });

  it("divisão que a ficha nova não tem não vira último, e a sugestão volta para a primeira", () => {
    expect(sequenciaDoTreino(["A", "B"], "D")).toEqual({ ultimo: null, proximo: "A" });
  });

  it("segue a ordem da lista, sem pular divisão que falta no meio", () => {
    expect(sequenciaDoTreino(["A", "C", "E"], "C")).toEqual({ ultimo: "C", proximo: "E" });
  });

  it("ficha sem exercício não sugere nada", () => {
    expect(sequenciaDoTreino([], "A")).toEqual({ ultimo: null, proximo: null });
  });
});

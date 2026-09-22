import { describe, it, expect } from "vitest";
import { divisoesDoTreino, paraGravar, resumoSeries, seriesDoExercicio, seriesUniformes } from "./seriesTreino";

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

import { describe, expect, it } from "vitest";
import { habitosPorSemana, inicioDaSemana, semanasNaMeta, ultimasSemanas } from "./evolucaoHabitos";

describe("hábitos por semana", () => {
  it("a semana vai de domingo a sábado, em Brasília", () => {
    expect(inicioDaSemana("2026-10-10")).toBe("2026-10-04"); // sábado
    expect(inicioDaSemana("2026-10-04")).toBe("2026-10-04"); // domingo
    expect(inicioDaSemana("2026-10-03")).toBe("2026-09-27");
  });

  it("as últimas semanas vêm da mais antiga para a atual, atravessando o mês", () => {
    expect(ultimasSemanas("2026-10-10", 3)).toEqual(["2026-09-20", "2026-09-27", "2026-10-04"]);
  });

  it("agrupa cada registro na sua semana e tira a média", () => {
    const [anterior, atual] = habitosPorSemana({
      semanas: ["2026-09-27", "2026-10-04"],
      diasDeTreino: ["2026-09-28", "2026-10-03", "2026-10-05"],
      esforcos: [
        { data: "2026-09-28", valor: 6 },
        { data: "2026-10-03", valor: 9 },
      ],
      sonos: [
        { data: "2026-09-28", valor: 2 },
        { data: "2026-10-03", valor: 5 },
      ],
      energias: [{ data: "2026-10-05", valor: 4 }],
      adesoes: [{ data: "2026-10-05", valor: 80 }],
      aguas: [{ data: "2026-10-05", valor: 2000 }],
    });
    expect(anterior).toEqual({ inicio: "2026-09-27", diasDeTreino: 2, esforcoMedio: 7.5, sonoMedio: 3.5, energiaMedia: null, adesaoMedia: null, aguaMedia: null });
    expect(atual).toEqual({ inicio: "2026-10-04", diasDeTreino: 1, esforcoMedio: null, sonoMedio: null, energiaMedia: 4, adesaoMedia: 80, aguaMedia: 2000 });
  });

  it("o mesmo dia na ficha e no calendário conta uma vez", () => {
    const [s] = habitosPorSemana({ semanas: ["2026-10-04"], diasDeTreino: ["2026-10-05", "2026-10-05"], esforcos: [], sonos: [], energias: [], adesoes: [], aguas: [] });
    expect(s.diasDeTreino).toBe(1);
  });

  it("dia com 0 ml de água não puxa a média para baixo", () => {
    const [s] = habitosPorSemana({
      semanas: ["2026-10-04"],
      diasDeTreino: [],
      esforcos: [],
      sonos: [],
      energias: [],
      adesoes: [],
      aguas: [
        { data: "2026-10-05", valor: 0 },
        { data: "2026-10-06", valor: 2500 },
      ],
    });
    expect(s.aguaMedia).toBe(2500);
  });

  it("constância contra a meta do aluno, só nas semanas fechadas", () => {
    const semanas = habitosPorSemana({
      semanas: ["2026-09-20", "2026-09-27", "2026-10-04"],
      diasDeTreino: ["2026-09-21", "2026-09-22", "2026-09-28", "2026-10-05", "2026-10-06"],
      esforcos: [],
      sonos: [],
      energias: [],
      adesoes: [],
      aguas: [],
    });
    expect(semanasNaMeta(semanas, 2)).toEqual({ batidas: 1, fechadas: 2 });
  });
});

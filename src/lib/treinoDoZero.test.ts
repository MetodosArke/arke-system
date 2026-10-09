import { describe, expect, it } from "vitest";
import { itensParaPublicar, problemaDoTreinoDoZero, proximaChave, type ItemDoZero } from "./treinoDoZero";

const item = (parcial: Partial<ItemDoZero> = {}): ItemDoZero => ({
  chave: 1,
  exercicio_id: "ex-1",
  nome_exercicio: "Agachamento livre",
  divisao: "A",
  series_lista: [
    { reps: "12", descanso_seg: 60, tecnica: null },
    { reps: "12", descanso_seg: 60, tecnica: null },
  ],
  descricao_execucao: "",
  observacoes: "",
  ...parcial,
});

describe("o treino montado do zero", () => {
  it("vai ao banco com o exercicio_id, a divisão e as séries resumidas", () => {
    expect(itensParaPublicar([item({ observacoes: "  devagar  " })])).toEqual([
      {
        exercicio_id: "ex-1",
        divisao: "A",
        series: 2,
        repeticoes: "12",
        descanso_seg: 60,
        series_detalhe: null,
        descricao_execucao: null,
        observacoes: "devagar",
      },
    ]);
  });

  it("séries diferentes levam o detalhe série a série, como o modelo grava", () => {
    const series = [
      { reps: "12", descanso_seg: 45, tecnica: null },
      { reps: "8", descanso_seg: 90, tecnica: "drop_set" as const },
    ];
    const [publicado] = itensParaPublicar([item({ series_lista: series, descricao_execucao: "Desça até 90 graus" })]);
    expect(publicado).toMatchObject({ series: 2, repeticoes: "12-8", descanso_seg: 45, series_detalhe: series, descricao_execucao: "Desça até 90 graus" });
  });

  it("mantém a ordem de inclusão (quem ordena por divisão é o banco)", () => {
    const publicados = itensParaPublicar([item({ divisao: "B", exercicio_id: "b" }), item({ divisao: "A", exercicio_id: "a" })]);
    expect(publicados.map((p) => `${p.divisao}:${p.exercicio_id}`)).toEqual(["B:b", "A:a"]);
  });

  it("a chave do próximo item é uma a mais que a maior, sem sorteio", () => {
    expect(proximaChave([])).toBe(1);
    expect(proximaChave([{ chave: 3 }, { chave: 7 }])).toBe(8);
  });

  it("diz o que falta antes de mandar, como o banco recusaria", () => {
    expect(problemaDoTreinoDoZero([])).toMatch(/pelo menos um exercício/);
    expect(problemaDoTreinoDoZero([item({ exercicio_id: "" })])).toMatch(/vem do acervo/);
    expect(problemaDoTreinoDoZero([item({ divisao: "Z" })])).toMatch(/Divisão inválida/);
    expect(problemaDoTreinoDoZero([item({ series_lista: [] })])).toMatch(/1 a 10 séries/);
    expect(problemaDoTreinoDoZero([item({ series_lista: [{ reps: " ", descanso_seg: 60, tecnica: null }] })])).toMatch(/repetições/);
    expect(problemaDoTreinoDoZero([item({ series_lista: [{ reps: "10", descanso_seg: 4000, tecnica: null }] })])).toMatch(/1 hora/);
    expect(problemaDoTreinoDoZero(Array.from({ length: 151 }, (_, i) => item({ chave: i + 1 })))).toMatch(/150/);
    expect(problemaDoTreinoDoZero([item(), item({ chave: 2, divisao: "B" })])).toBeNull();
  });
});

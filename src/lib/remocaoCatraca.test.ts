import { describe, expect, it } from "vitest";
import { mensagemDaRemocao } from "./remocaoCatraca";

describe("mensagem depois de retirar a autorização da biometria", () => {
  it("sem número na catraca, não promete remoção nenhuma", () => {
    const m = mensagemDaRemocao({ numero: null, ordens: 0, tarefas: 0 });
    expect(m).not.toMatch(/tarefa|Gateway vai/);
  });

  it("só fala da tarefa quando ela existe", () => {
    expect(mensagemDaRemocao({ numero: "7", ordens: 0, tarefas: 1 })).toMatch(/tarefa/);
    expect(mensagemDaRemocao({ numero: "7", ordens: 2, tarefas: 0 })).not.toMatch(/tarefa/);
    expect(mensagemDaRemocao({ numero: "7", ordens: 2, tarefas: 0 })).toMatch(/2 catracas/);
  });

  it("com ordens e tarefa, diz as duas coisas", () => {
    const m = mensagemDaRemocao({ numero: "7", ordens: 1, tarefas: 1 });
    expect(m).toMatch(/1 catraca,/);
    expect(m).toMatch(/tarefa/);
  });

  it("número sem nada agendado (o que não deveria acontecer) não inventa nada", () => {
    expect(mensagemDaRemocao({ numero: "7", ordens: 0, tarefas: 0 })).toBe("Autorização retirada.");
  });
});

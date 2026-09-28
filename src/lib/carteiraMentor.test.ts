import { describe, expect, it } from "vitest";
import { filtrarCarteira, rotuloAtencao, travaOAluno } from "./carteiraMentor";

const alunos = [
  { aluno_id: "1", aluno_nome: "Ana Júlia", organizacao_nome: "Academia Horizonte", mentor_id: "m1", atencao: ["mensagem"] },
  { aluno_id: "2", aluno_nome: "Bruno", organizacao_nome: "Arke", mentor_id: null, atencao: ["sem_mentor", "anamnese"] },
  { aluno_id: "3", aluno_nome: "Carla", organizacao_nome: "Academia Horizonte", mentor_id: "m2", atencao: [] },
];

describe("filtrarCarteira", () => {
  it("todos devolve a lista inteira", () => {
    expect(filtrarCarteira(alunos, "todos", "m1")).toHaveLength(3);
  });

  it("meus devolve só a carteira de quem está logado", () => {
    expect(filtrarCarteira(alunos, "meus", "m1").map((a) => a.aluno_id)).toEqual(["1"]);
  });

  it("meus sem usuário não devolve ninguém", () => {
    expect(filtrarCarteira(alunos, "meus", null)).toEqual([]);
  });

  it("sem mentor devolve quem ainda não tem responsável", () => {
    expect(filtrarCarteira(alunos, "sem_mentor", "m1").map((a) => a.aluno_id)).toEqual(["2"]);
  });

  it("atenção deixa de fora quem não tem sinal", () => {
    expect(filtrarCarteira(alunos, "atencao", "m1").map((a) => a.aluno_id)).toEqual(["1", "2"]);
  });

  it("busca sem acento, pelo aluno ou pela academia", () => {
    expect(filtrarCarteira(alunos, "todos", null, "julia").map((a) => a.aluno_id)).toEqual(["1"]);
    expect(filtrarCarteira(alunos, "todos", null, "HORIZONTE").map((a) => a.aluno_id)).toEqual(["1", "3"]);
  });
});

describe("sinais de atenção", () => {
  it("tem texto para cada sinal e devolve o próprio código se vier um novo", () => {
    expect(rotuloAtencao("anamnese")).toBe("Acolhimento pendente");
    expect(rotuloAtencao("novo_sinal")).toBe("novo_sinal");
  });

  it("separa o que trava o aluno do que só pede atenção", () => {
    expect(travaOAluno("dor")).toBe(true);
    expect(travaOAluno("mensagem")).toBe(false);
  });
});

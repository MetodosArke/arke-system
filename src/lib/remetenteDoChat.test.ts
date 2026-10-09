import { describe, expect, it } from "vitest";
import { colegasNaConversa, EQUIPE_SEM_NOME, remetenteDaMensagem } from "./remetenteDoChat";

const nomes = new Map([["renata", "Renata Albuquerque"]]);
const daEquipe = (id: string) => ({ remetente_tipo: "treinador", remetente_id: id });
const doAluno = { remetente_tipo: "aluno", remetente_id: "isabela" };
const equipe = { lado: "staff" as const, canal: "treino" as const, meuUserId: "diego", nomes };

describe("remetenteDaMensagem", () => {
  it("do lado da equipe, a própria mensagem é Você, à direita e na cor de quem lê", () => {
    expect(remetenteDaMensagem(daEquipe("diego"), equipe)).toEqual({ rotulo: "Você", minha: true, daEquipe: true, doMeuLado: true });
  });

  it("a de outra pessoa da equipe leva o nome dela, do mesmo lado, mas não é minha", () => {
    expect(remetenteDaMensagem(daEquipe("renata"), equipe)).toEqual({
      rotulo: "Renata Albuquerque",
      minha: false,
      daEquipe: true,
      doMeuLado: true,
    });
  });

  it("sem o nome (ou com nome em branco), cai no rótulo neutro", () => {
    expect(remetenteDaMensagem(daEquipe("saiu"), equipe).rotulo).toBe(EQUIPE_SEM_NOME);
    expect(remetenteDaMensagem(daEquipe("x"), { ...equipe, nomes: new Map([["x", "  "]]) }).rotulo).toBe(EQUIPE_SEM_NOME);
  });

  it("sem saber quem lê, nenhuma mensagem da equipe vira Você", () => {
    expect(remetenteDaMensagem(daEquipe("diego"), { ...equipe, meuUserId: undefined }).minha).toBe(false);
  });

  it("a do aluno, para a equipe, é Aluno, do outro lado", () => {
    expect(remetenteDaMensagem(doAluno, equipe)).toEqual({ rotulo: "Aluno", minha: false, daEquipe: false, doMeuLado: false });
  });

  it("o aluno vê a função de quem respondeu, por canal, e nunca o nome", () => {
    const aluno = { lado: "aluno" as const, meuUserId: "isabela", nomes };
    expect(remetenteDaMensagem(daEquipe("renata"), { ...aluno, canal: "treino" }).rotulo).toBe("Treinador(a)");
    expect(remetenteDaMensagem({ remetente_tipo: "nutricionista", remetente_id: "renata" }, { ...aluno, canal: "nutri" }).rotulo).toBe(
      "Nutricionista",
    );
    expect(remetenteDaMensagem(doAluno, { ...aluno, canal: "treino" })).toEqual({ rotulo: "Você", minha: true, daEquipe: false, doMeuLado: true });
  });
});

describe("colegasNaConversa", () => {
  const conversa = [doAluno, daEquipe("renata"), daEquipe("diego"), daEquipe("renata"), daEquipe("ana")];

  it("as outras pessoas da equipe, sem repetir, em ordem, e nunca quem lê nem o aluno", () => {
    expect(colegasNaConversa(conversa, "staff", "diego")).toEqual(["ana", "renata"]);
  });

  it("do lado do aluno, ninguém: ele não lê o perfil da equipe", () => {
    expect(colegasNaConversa(conversa, "aluno", "isabela")).toEqual([]);
  });
});

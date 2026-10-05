import { describe, expect, it } from "vitest";
import { filtrarAlunos, semAcento } from "./buscaAlunos";

const ALUNOS = [
  { id: 1, full_name: "Ana Paula da Silva", telefone: "(11) 98765-4321", cpf: "529.982.247-25", situacao_academia: "em_dia" },
  { id: 2, full_name: "João Pedro Souza", telefone: "11912345678", cpf: null, situacao_academia: "inadimplente" },
  { id: 3, full_name: "Márcia Conceição", telefone: null, cpf: "11144477735", situacao_academia: "pausado" },
  { id: 4, full_name: null, telefone: null, cpf: null, situacao_academia: "em_dia" },
];
const ids = (l: { id: number }[]) => l.map((a) => a.id);

describe("busca de alunos", () => {
  it("sem busca nem filtro, todos", () => {
    expect(ids(filtrarAlunos(ALUNOS, ""))).toEqual([1, 2, 3, 4]);
    expect(ids(filtrarAlunos(ALUNOS, "   "))).toEqual([1, 2, 3, 4]);
  });

  it("pelo nome, sem acento, sem maiúscula e em qualquer ordem", () => {
    expect(ids(filtrarAlunos(ALUNOS, "marcia"))).toEqual([3]);
    expect(ids(filtrarAlunos(ALUNOS, "CONCEIÇÃO"))).toEqual([3]);
    expect(ids(filtrarAlunos(ALUNOS, "silva ana"))).toEqual([1]);
    expect(ids(filtrarAlunos(ALUNOS, "joão souza"))).toEqual([2]);
    expect(ids(filtrarAlunos(ALUNOS, "pedro ana"))).toEqual([]);
  });

  it("pelo telefone ou pelo CPF, com ou sem máscara", () => {
    expect(ids(filtrarAlunos(ALUNOS, "98765"))).toEqual([1]);
    expect(ids(filtrarAlunos(ALUNOS, "(11) 91234"))).toEqual([2]);
    expect(ids(filtrarAlunos(ALUNOS, "529.982"))).toEqual([1]);
    expect(ids(filtrarAlunos(ALUNOS, "11144477735"))).toEqual([3]);
  });

  it("número curto demais não busca por telefone (casaria quase todos)", () => {
    expect(ids(filtrarAlunos(ALUNOS, "11"))).toEqual([]);
  });

  it("filtro de situação, sozinho e junto da busca", () => {
    expect(ids(filtrarAlunos(ALUNOS, "", "inadimplente"))).toEqual([2]);
    expect(ids(filtrarAlunos(ALUNOS, "ana", "pausado"))).toEqual([]);
    expect(ids(filtrarAlunos(ALUNOS, "ana", "em_dia"))).toEqual([1]);
  });

  it("sem acento", () => {
    expect(semAcento("  Ágata Ñ  ")).toBe("agata n");
  });
});

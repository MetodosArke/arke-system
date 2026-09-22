import { describe, it, expect } from "vitest";
import { filtrarExercicios, type ExercicioBusca } from "./buscaExercicios";

const LISTA: ExercicioBusca[] = [
  { id: "1", nome: "Supino reto", grupo_muscular: "Peito", grupos_musculares: ["Peito", "Tríceps"], equipamento: "Barra", organization_id: null },
  { id: "2", nome: "Supino com halteres", grupo_muscular: "Peito", grupos_musculares: ["Peito"], equipamento: "Halteres", organization_id: null },
  { id: "3", nome: "Rosca direta", grupo_muscular: "Bíceps", grupos_musculares: ["Bíceps"], equipamento: "Barra", organization_id: "org" },
  { id: "4", nome: "Crucifixo antigo", grupo_muscular: "Peito", equipamento: "Halteres", organization_id: null, ativo: false },
];

describe("busca de exercícios na prescrição", () => {
  it("combina grupo e equipamento, como o filtro do original", () => {
    expect(filtrarExercicios(LISTA, { grupo: "Peito", equipamento: "Halteres" }).map((e) => e.id)).toEqual(["2"]);
  });

  it("grupo secundário também encontra (Tríceps acha o supino)", () => {
    expect(filtrarExercicios(LISTA, { grupo: "Tríceps" }).map((e) => e.id)).toEqual(["1"]);
  });

  it("texto sem acento e sem caixa", () => {
    expect(filtrarExercicios(LISTA, { texto: "SUPINO" }).map((e) => e.id)).toEqual(["2", "1"]);
    expect(filtrarExercicios(LISTA, { texto: "biceps" }).map((e) => e.id)).toEqual(["3"]);
  });

  it("inativo não aparece, e os da academia vêm primeiro", () => {
    const todos = filtrarExercicios(LISTA, {});
    expect(todos.map((e) => e.id)).not.toContain("4");
    expect(todos[0].id).toBe("3");
  });
});

import { describe, expect, it } from "vitest";
import { detectarCampo, mapearColunas } from "./mapaColunas";

describe("detectarCampo", () => {
  it.each([
    ["Nome", "full_name"],
    ["Nome Completo", "full_name"],
    ["Nome do Cliente", "full_name"],
    ["Cliente", "full_name"],
    ["E-mail", "email"],
    ["Email Principal", "email"],
    ["Celular", "telefone"],
    ["Telefone Celular", "telefone"],
    ["WhatsApp", "telefone"],
    ["CPF", "cpf"],
    ["Status", "situacao"],
    ["Situação", "situacao"],
    ["Status do Cliente", "situacao"],
    ["Situação do Contrato", "situacao"],
  ])("%s → %s", (coluna, campo) => {
    expect(detectarCampo(coluna)).toBe(campo);
  });

  it.each([["Nome da Mãe"], ["Nome do Responsável"], ["E-mail do Responsável"], ["CPF do Responsável"], ["Telefone de Emergência"], ["Nome Social"], ["Plano"], ["Professor"]])(
    "%s não é dado do aluno",
    (coluna) => {
      expect(detectarCampo(coluna)).toBe("ignorar");
    }
  );
});

describe("mapearColunas", () => {
  it("cada campo recebe uma coluna só — a primeira", () => {
    expect(mapearColunas(["Nome", "Celular", "Telefone", "Nome da Mãe", "Status"])).toEqual({
      Nome: "full_name",
      Celular: "telefone",
      Telefone: "ignorar",
      "Nome da Mãe": "ignorar",
      Status: "situacao",
    });
  });

  it("exportação típica de sistema de academia", () => {
    const mapa = mapearColunas(["Código", "Nome do Cliente", "CPF", "E-mail", "Celular", "Data de Nascimento", "Status do Cliente", "Plano"]);
    expect(mapa).toMatchObject({
      "Nome do Cliente": "full_name",
      CPF: "cpf",
      "E-mail": "email",
      Celular: "telefone",
      "Status do Cliente": "situacao",
      Plano: "ignorar",
      Código: "ignorar",
    });
  });
});

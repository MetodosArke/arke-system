import { describe, expect, it } from "vitest";
import { detectarCampo, juntarPartes, mapearColunas } from "./mapaColunas";

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

describe("sobrenome e DDD em coluna própria", () => {
  it("reconhece as colunas", () => {
    expect(detectarCampo("Sobrenome")).toBe("sobrenome");
    expect(detectarCampo("Last Name")).toBe("sobrenome");
    expect(detectarCampo("First Name")).toBe("full_name");
    expect(detectarCampo("DDD")).toBe("ddd");
    expect(detectarCampo("DDD Celular")).toBe("ddd");
    // O telefone inteiro continua sendo telefone.
    expect(detectarCampo("Celular (com DDD)")).toBe("telefone");
    expect(detectarCampo("DDD do responsável")).toBe("ignorar");
  });

  it("junta o sobrenome ao nome, sem duplicar", () => {
    expect(juntarPartes({ full_name: "Maria", sobrenome: "Souza" }).full_name).toBe("Maria Souza");
    expect(juntarPartes({ full_name: "Maria Souza", sobrenome: "Souza" }).full_name).toBe("Maria Souza");
    expect(juntarPartes({ full_name: "Maria", sobrenome: "" }).full_name).toBe("Maria");
  });

  it("completa o telefone sem DDD e não mexe no que já tem", () => {
    expect(juntarPartes({ telefone: "98765-4321", ddd: "11" }).telefone).toBe("11987654321");
    expect(juntarPartes({ telefone: "3456-7890", ddd: "(011)" }).telefone).toBe("1134567890");
    expect(juntarPartes({ telefone: "(21) 98765-4321", ddd: "11" }).telefone).toBe("(21) 98765-4321");
    expect(juntarPartes({ telefone: "", ddd: "11" }).telefone).toBe("");
  });
});

describe("endereço", () => {
  it("reconhece as colunas de endereço das exportações", () => {
    expect(detectarCampo("CEP")).toBe("cep");
    expect(detectarCampo("Endereço")).toBe("logradouro");
    expect(detectarCampo("Logradouro")).toBe("logradouro");
    expect(detectarCampo("Número")).toBe("endereco_numero");
    expect(detectarCampo("Nº")).toBe("endereco_numero");
    expect(detectarCampo("Complemento")).toBe("complemento");
    expect(detectarCampo("Bairro")).toBe("bairro");
    expect(detectarCampo("Cidade")).toBe("cidade");
    expect(detectarCampo("UF")).toBe("uf");
    expect(detectarCampo("Estado")).toBe("uf");
  });

  it("não confunde o que só parece endereço", () => {
    expect(detectarCampo("Endereço eletrônico")).toBe("email");
    expect(detectarCampo("Estado civil")).toBe("ignorar");
    expect(detectarCampo("Número do cliente")).toBe("ignorar");
    expect(detectarCampo("Endereço do responsável")).toBe("ignorar");
    expect(detectarCampo("Cidade de nascimento")).toBe("ignorar");
  });
});

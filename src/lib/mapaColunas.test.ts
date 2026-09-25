import { describe, expect, it } from "vitest";
import { detectarCampo, juntarPartes, mapearColunas, normalizarRegistro } from "./mapaColunas";

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

// Cabeçalhos das exportações de EVO, Next Fit e Tecnofit, como saem de cada sistema.
describe("exportações dos concorrentes", () => {
  it("EVO: cabeçalho em maiúsculas com sublinhado", () => {
    expect(
      mapearColunas([
        "ID_MEMBRO", "NOME_COMPLETO", "CPF_ALUNO", "DATA_NASC", "GENERO", "EMAIL_CONTATO",
        "CELULAR", "STATUS_CONTRATO", "PLANO_ATUAL", "DATA_INICIO", "DATA_FIM", "MATRICULA_CATRACA",
      ]),
    ).toEqual({
      ID_MEMBRO: "ignorar",
      NOME_COMPLETO: "full_name",
      CPF_ALUNO: "cpf",
      DATA_NASC: "ignorar",
      GENERO: "ignorar",
      EMAIL_CONTATO: "email",
      CELULAR: "telefone",
      STATUS_CONTRATO: "situacao",
      PLANO_ATUAL: "ignorar",
      DATA_INICIO: "ignorar",
      DATA_FIM: "ignorar",
      MATRICULA_CATRACA: "ignorar",
    });
  });

  it("Tecnofit: palavras coladas e DDD em coluna própria", () => {
    expect(
      mapearColunas(["Matricula", "Aluno", "CPF", "DataNascimento", "Email", "DDD", "Telefone", "Status", "Plano", "VencimentoContrato", "DigitalCadastrada"]),
    ).toMatchObject({
      Aluno: "full_name",
      CPF: "cpf",
      DataNascimento: "ignorar",
      Email: "email",
      DDD: "ddd",
      Telefone: "telefone",
      Status: "situacao",
      VencimentoContrato: "ignorar",
      DigitalCadastrada: "ignorar",
    });
  });

  it("Next Fit: cartão e contrato não viram dado do aluno", () => {
    expect(
      mapearColunas(["Código", "Nome do Cliente", "CPF", "E-mail", "Telefone / Celular", "Situação", "Contrato Ativo", "Código do Cartão / Tag"]),
    ).toMatchObject({
      "Nome do Cliente": "full_name",
      "Telefone / Celular": "telefone",
      Situação: "situacao",
      "Contrato Ativo": "ignorar",
      "Código do Cartão / Tag": "ignorar",
    });
  });
});

describe("normalizarRegistro", () => {
  it("nome todo em maiúsculas vira nome próprio, com as partículas em minúsculas", () => {
    expect(normalizarRegistro({ full_name: "CARLOS EDUARDO DA SILVA" }).full_name).toBe("Carlos Eduardo da Silva");
    expect(normalizarRegistro({ full_name: "MARIA DOS SANTOS E SOUZA" }).full_name).toBe("Maria dos Santos e Souza");
    expect(normalizarRegistro({ full_name: "JOÃO CONCEIÇÃO" }).full_name).toBe("João Conceição");
  });

  it("nome já escrito com maiúsculas e minúsculas fica como a academia digitou", () => {
    expect(normalizarRegistro({ full_name: "Ana de Oliveira McCartney" }).full_name).toBe("Ana de Oliveira McCartney");
  });

  it("CPF que perdeu o zero à esquerda na planilha volta a ter 11 dígitos", () => {
    expect(normalizarRegistro({ cpf: "3928102930" }).cpf).toBe("03928102930");
    expect(normalizarRegistro({ cpf: "529982247" }).cpf).toBe("00529982247");
    expect(normalizarRegistro({ cpf: "529.982.247-25" }).cpf).toBe("529.982.247-25");
    expect(normalizarRegistro({ cpf: "12345" }).cpf).toBe("12345");
  });

  it("celular com o 55 do Brasil perde o código do país", () => {
    expect(normalizarRegistro({ telefone: "5511988223344" }).telefone).toBe("11988223344");
    expect(normalizarRegistro({ telefone: "+55 (11) 3322-4455" }).telefone).toBe("1133224455");
    expect(normalizarRegistro({ telefone: "(11) 98123-4567" }).telefone).toBe("(11) 98123-4567");
  });

  it("e-mail em minúsculas e sem espaço", () => {
    expect(normalizarRegistro({ email: " Carlos.Silva@Email.com " }).email).toBe("carlos.silva@email.com");
  });

  it("não inventa campo que a linha não tem", () => {
    expect(normalizarRegistro({ full_name: "Ana" })).toEqual({ full_name: "Ana" });
  });
});

import { describe, it, expect } from "vitest";
import { utils, write } from "xlsx";
import { decodificarTexto, ehPlanilhaBinaria, lerLinhasPlanilha } from "./lerPlanilha";
import { mapearColunas } from "./mapaColunas";

const CSV = "Nome;E-mail;Celular;CPF;Situação do contrato\nJoão Conceição;joao@x.com;(11) 99999-0000;529.982.247-25;Ativo\n";

const bytes = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
// Windows-1252 é igual ao Latin-1 para os acentos do português.
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s: string) => new TextEncoder().encode(s);
const comBom = (b: Uint8Array) => Uint8Array.from([0xef, 0xbb, 0xbf, ...b]);

describe("leitura do arquivo da importação de alunos", () => {
  it.each([
    ["Windows-1252 (Excel brasileiro)", latin1(CSV)],
    ["UTF-8 sem BOM (exportação de sistema web)", utf8(CSV)],
    ["UTF-8 com BOM", comBom(utf8(CSV))],
    ["UTF-8 separado por vírgula", utf8(CSV.replace(/;/g, ","))],
  ])("%s: acentos certos e colunas reconhecidas", async (_nome, arquivo) => {
    const linhas = await lerLinhasPlanilha(bytes(arquivo));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]["Nome"]).toBe("João Conceição");
    expect(Object.keys(linhas[0])).toContain("Situação do contrato");
    expect(mapearColunas(Object.keys(linhas[0]))["Situação do contrato"]).toBe("situacao");
  });

  it("xlsx segue direto para a biblioteca", async () => {
    const livro = utils.book_new();
    utils.book_append_sheet(livro, utils.aoa_to_sheet([["Nome", "CPF"], ["Maria Conceição", "529.982.247-25"]]), "Alunos");
    const xlsx = new Uint8Array(write(livro, { type: "array", bookType: "xlsx" }));
    expect(ehPlanilhaBinaria(xlsx)).toBe(true);
    const linhas = await lerLinhasPlanilha(bytes(xlsx));
    expect(linhas[0]["Nome"]).toBe("Maria Conceição");
  });

  it("CSV não é tratado como binário, e Windows-1252 não passa por UTF-8", () => {
    expect(ehPlanilhaBinaria(utf8(CSV))).toBe(false);
    expect(decodificarTexto(latin1("Situação"))).toBe("Situação");
    expect(decodificarTexto(utf8("Situação"))).toBe("Situação");
  });

  it("CSV chega como texto: zero à esquerda e data ficam como estão na planilha", async () => {
    const csv = "Aluno;CPF;DataNascimento;Telefone\nAna Lima;01234567890;01/02/1990;011988223344\n";
    const [linha] = await lerLinhasPlanilha(bytes(utf8(csv)));
    expect(linha["CPF"]).toBe("01234567890");
    expect(linha["DataNascimento"]).toBe("01/02/1990");
    expect(linha["Telefone"]).toBe("011988223344");
  });
});

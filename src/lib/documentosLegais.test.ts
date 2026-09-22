import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENTOS } from "./documentosLegais";
import { blocosMarkdown } from "./markdownSimples";

const ARQUIVO: Record<string, string> = {
  termos_uso: "termos-uso.md",
  privacidade: "privacidade.md",
  contrato_academia: "contrato-academia.md",
};

describe("documentos legais", () => {
  // O aceite registrado aponta para versão + hash. Texto alterado com o mesmo
  // hash seria aceite de um texto que ninguém leu.
  it.each(Object.entries(DOCUMENTOS))("%s: o texto bate com o hash da versão publicada", (tipo, doc) => {
    const texto = readFileSync(resolve(__dirname, "../content/legal", ARQUIVO[tipo]), "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(texto, "utf8").digest("hex")).toBe(doc.sha256);
  });

  it("cada documento começa com um título", () => {
    for (const doc of Object.values(DOCUMENTOS)) {
      expect(blocosMarkdown(doc.texto)[0]).toMatchObject({ tipo: "h1" });
    }
  });
});

describe("markdown simples", () => {
  it("títulos, parágrafos, listas e negrito", () => {
    expect(blocosMarkdown("# T\n\nlinha um\nlinha dois\n\n- a\n- b\n\n1. x\n2. y\n\n## S")).toEqual([
      { tipo: "h1", texto: "T" },
      { tipo: "p", texto: "linha um linha dois" },
      { tipo: "ul", itens: ["a", "b"] },
      { tipo: "ol", itens: ["x", "y"] },
      { tipo: "h2", texto: "S" },
    ]);
  });

  it("HTML vira texto, não marcação", () => {
    expect(blocosMarkdown("<script>alert(1)</script>")).toEqual([{ tipo: "p", texto: "<script>alert(1)</script>" }]);
  });
});

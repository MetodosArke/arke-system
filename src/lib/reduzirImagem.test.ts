import { describe, expect, it } from "vitest";
import { dimensoesReduzidas, extensaoDoTipo, nomeComExtensao, passaSemReduzir } from "./reduzirImagem";

describe("reduzir a imagem antes de subir", () => {
  it("cabe no lado maior, mantendo a proporção", () => {
    expect(dimensoesReduzidas(4032, 3024, 1600)).toEqual({ largura: 1600, altura: 1200 });
    expect(dimensoesReduzidas(3024, 4032, 1600)).toEqual({ largura: 1200, altura: 1600 });
    expect(dimensoesReduzidas(2000, 500, 512)).toEqual({ largura: 512, altura: 128 });
  });

  it("não aumenta imagem pequena", () => {
    expect(dimensoesReduzidas(800, 600, 1600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesReduzidas(1600, 900, 1600)).toEqual({ largura: 1600, altura: 900 });
  });

  it("imagem estreita demais não vira zero", () => {
    expect(dimensoesReduzidas(10000, 1, 512)).toEqual({ largura: 512, altura: 1 });
  });

  it("SVG e GIF passam como vieram; o resto é reduzido", () => {
    expect(passaSemReduzir("image/svg+xml")).toBe(true);
    expect(passaSemReduzir("image/gif")).toBe(true);
    for (const tipo of ["image/jpeg", "image/png", "image/webp", "image/heic"]) expect(passaSemReduzir(tipo)).toBe(false);
  });

  it("a extensão segue o tipo que de fato saiu", () => {
    expect(extensaoDoTipo("image/jpeg")).toBe("jpg");
    expect(extensaoDoTipo("image/webp")).toBe("webp");
    expect(extensaoDoTipo("image/png")).toBe("png");
    expect(nomeComExtensao("agachamento.png", "image/webp")).toBe("agachamento.webp");
    expect(nomeComExtensao("foto.final.JPG", "image/jpeg")).toBe("foto.final.jpg");
    expect(nomeComExtensao("sem-extensao", "image/webp")).toBe("sem-extensao.webp");
  });
});

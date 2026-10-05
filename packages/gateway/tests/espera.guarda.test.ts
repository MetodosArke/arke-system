import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Toda espera que dobra a cada falha passa por `comVariacao`. Sem ela, os
 * Gateways que caíram juntos voltariam juntos, a cada rodada.
 */
function arquivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const caminho = path.join(dir, d.name);
    return d.isDirectory() ? arquivos(caminho) : /\.ts$/.test(d.name) ? [caminho] : [];
  });
}

describe("espera que dobra tem variação", () => {
  it("quem dobra a espera usa comVariacao", () => {
    const raiz = path.join(__dirname, "..", "src");
    const semVariacao = arquivos(raiz)
      .filter((f) => /Math\.min\(\s*[\w.]+\s*\*\s*2\s*,/.test(fs.readFileSync(f, "utf-8")))
      .filter((f) => !/comVariacao\(/.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(raiz, f));
    expect(semVariacao).toEqual([]);
  });
});

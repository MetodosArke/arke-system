import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Código, token e senha saem do gerador criptográfico
 * (`crypto.getRandomValues`, `crypto.randomUUID`), nunca de `Math.random()`:
 * a sequência dele dá para prever. Até 04/10/2026, o código curto do link de
 * ativação, que abre a definição de senha de uma conta, saía de Math.random().
 *
 * Exceções, cada uma com o motivo: onde o sorteio não protege nada.
 */
const RAIZ = join(__dirname, "..", "..");

const EXCECOES: Record<string, string> = {
  "src/components/ui/sidebar.tsx": "largura do esqueleto de carregamento do menu",
};

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "node_modules" ? [] : arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("sorteio só pelo gerador criptográfico", () => {
  it("nenhuma função e nenhuma tela usa Math.random(), fora das exceções", () => {
    const usos = [...arquivos(join(RAIZ, "supabase", "functions")), ...arquivos(join(RAIZ, "src"))]
      .map((caminho) => relative(RAIZ, caminho).replace(/\\/g, "/"))
      .filter((rel) => !EXCECOES[rel] && /Math\.random\(/.test(readFileSync(join(RAIZ, rel), "utf8")));
    expect(usos).toEqual([]);
  });

  it("as exceções ainda existem (senão saem da lista)", () => {
    for (const rel of Object.keys(EXCECOES)) {
      expect(readFileSync(join(RAIZ, rel), "utf8"), rel).toMatch(/Math\.random\(/);
    }
  });
});

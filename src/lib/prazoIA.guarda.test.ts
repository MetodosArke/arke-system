import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda chamada ao modelo tem prazo. Até 04/10/2026, `conversarComIA` não
 * tinha: uma resposta presa segurava a função até o limite da plataforma,
 * e o mentor esperava um rascunho que não vinha.
 */
const IA = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "_shared", "ia.ts"), "utf8");

describe("chamadas ao modelo com prazo", () => {
  it("todo fetch de _shared/ia.ts leva AbortSignal.timeout", () => {
    const chamadas = IA.match(/await fetch\([^;]*;/g) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    expect(chamadas.filter((c) => !/signal: AbortSignal\.timeout\(/.test(c))).toEqual([]);
  });
});

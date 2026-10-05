import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration nova começa com `set lock_timeout`. Sem ele, um `alter table`
 * que espera a trava de uma tabela ocupada (a de acessos da catraca no pico
 * das 18h, por exemplo) faz toda leitura e gravação dela esperar atrás dele,
 * e o app e a catraca param enquanto a migration espera. Com ele, a migration
 * desiste em segundos e é rodada de novo; ninguém fica esperando.
 *
 * Vale a partir de 04/10/2026 (`20261324010000`): as anteriores já rodaram.
 */
const PASTA = join(__dirname, "..", "..", "supabase", "migrations");
const DESDE = "20261324010000";

const novas = readdirSync(PASTA)
  .filter((nome) => nome.endsWith(".sql") && nome.slice(0, 14) >= DESDE)
  .map((nome) => ({ nome, sql: readFileSync(join(PASTA, nome), "utf8") }));

describe("migrations novas não seguram tabela", () => {
  it("as migrations novas foram achadas", () => {
    expect(novas.length).toBeGreaterThanOrEqual(4);
  });

  it("toda migration nova define lock_timeout antes do primeiro comando", () => {
    const sem = novas
      .filter(({ sql }) => {
        const semComentario = sql.replace(/--[^\n]*/g, "").trim();
        return !/^set\s+lock_timeout\s*=\s*'\d+s'\s*;/i.test(semComentario);
      })
      .map(({ nome }) => nome);
    expect(sem).toEqual([]);
  });
});

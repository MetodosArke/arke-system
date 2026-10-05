import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O histórico do banco (`supabase/historico/`) é o que deixa o repositório
 * recriar o banco de produção do zero, sem backup: a ordem em que as
 * migrations rodaram e o texto que de fato rodou em cada uma. Ele é um
 * retrato, gerado por `scripts/migracao/historico.mjs`; migration nova entra
 * na reconstrução pela versão, depois de `ultima_versao`.
 *
 * Este teste não fala com o banco. Confere que o retrato é coerente com o
 * repositório: todo arquivo que ele cita existe, a ordem não volta atrás, e
 * todo arquivo de `supabase/migrations/` está no histórico, fora da ordem com
 * o motivo, ou depois do retrato. Um arquivo antigo que ninguém explica é
 * exatamente o que faria a reconstrução divergir sem avisar.
 */
const RAIZ = join(__dirname, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const HISTORICO = join(RAIZ, "supabase", "historico");

type Ordem = {
  ultima_versao: string;
  passos: { versao: string; nome: string; arquivo: string }[];
  fora_da_ordem: { arquivo: string; motivo: string }[];
};
const ordem = JSON.parse(readFileSync(join(HISTORICO, "ordem.json"), "utf8")) as Ordem;

describe("histórico do banco no repositório", () => {
  it("começa no reset do schema e tem a história inteira", () => {
    expect(ordem.passos[0].nome).toBe("reset_schema_public");
    expect(ordem.passos.length).toBeGreaterThan(250);
  });

  it("a ordem é a das versões, sem repetir nem voltar atrás", () => {
    const fora = ordem.passos.filter((p, i) => i > 0 && p.versao <= ordem.passos[i - 1].versao).map((p) => p.versao);
    expect(fora).toEqual([]);
    expect(ordem.ultima_versao).toBe(ordem.passos.at(-1)?.versao);
  });

  it("todo arquivo citado existe", () => {
    const faltam = [...ordem.passos.map((p) => p.arquivo), ...ordem.fora_da_ordem.map((f) => f.arquivo)].filter(
      (arquivo) => !existsSync(join(RAIZ, arquivo))
    );
    expect(faltam).toEqual([]);
  });

  it("toda cópia fiel da pasta do histórico é usada", () => {
    const citados = new Set(ordem.passos.map((p) => p.arquivo));
    const soltas = readdirSync(HISTORICO)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => !citados.has(`supabase/historico/${f}`));
    expect(soltas).toEqual([]);
  });

  it("toda migration do repositório está no histórico, fora da ordem com motivo, ou depois do retrato", () => {
    const citados = new Set([...ordem.passos.map((p) => p.arquivo), ...ordem.fora_da_ordem.map((f) => f.arquivo)]);
    const semExplicacao = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => f.split("_")[0] <= ordem.ultima_versao && !citados.has(`supabase/migrations/${f}`));
    expect(semExplicacao).toEqual([]);
    expect(ordem.fora_da_ordem.every((f) => f.motivo.length > 10)).toBe(true);
  });
});

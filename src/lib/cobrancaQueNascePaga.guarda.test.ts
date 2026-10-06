import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A cobrança que já nasce paga também vira receita e nota fiscal.
 *
 * Os gatilhos do dinheiro que entrou eram só `after update`, e o webhook cria
 * a linha já confirmada quando o aviso de emissão se perde e a conferência
 * reenvia a confirmação. O pagamento ficava sem lançamento e sem nota
 * (auditoria de 05/10/2026). Esta trava confere a **última** definição de
 * cada gatilho e de cada função nas migrations: um `create trigger` novo só
 * com `after update` volta a quebrar.
 */
const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8").toLowerCase().replace(/\r\n/g, "\n"));

function ultimo(re: RegExp): string {
  let achado = "";
  for (const sql of migrations) for (const m of sql.match(re) ?? []) achado = m;
  return achado;
}

const gatilho = (nome: string, tabela: string) =>
  ultimo(new RegExp(`create trigger ${nome}\\s+after [a-z ]+ on public\\.${tabela}\\b`, "g"));
const funcao = (nome: string) => ultimo(new RegExp(`create or replace function public\\.${nome}\\(\\)[\\s\\S]*?\\n\\$\\$;`, "g"));

describe("a cobrança que nasce paga vira receita e nota", () => {
  it("os gatilhos da receita valem na inclusão e na alteração", () => {
    expect(gatilho("trg_lancar_receita_mensalidade", "mensalidades")).toMatch(/after insert or update on/);
    expect(gatilho("trg_lancar_receita_cobranca_avulsa", "cobrancas_avulsas")).toMatch(/after insert or update on/);
  });

  it("o gatilho da nota fiscal vale na inclusão e na alteração, nas três origens", () => {
    for (const tabela of ["mensalidades", "cobrancas_avulsas", "pagamentos"]) {
      expect(gatilho("trg_enfileirar_nota_fiscal", tabela), tabela).toMatch(/after insert or update on/);
    }
  });

  it("as funções só leem o status anterior na alteração", () => {
    for (const nome of ["lancar_receita_mensalidade", "lancar_receita_cobranca_avulsa", "enfileirar_nota_fiscal"]) {
      const corpo = funcao(nome);
      expect(corpo, nome).toMatch(/tg_op = 'update'/);
      // Sem `old.status` fora de um teste de tg_op: na inclusão não há linha anterior.
      expect(corpo, nome).not.toMatch(/new\.status = 'confirmado' and old\.status is distinct from 'confirmado'/);
    }
  });

  it("e nada duplica: o lançamento e a nota continuam com `on conflict do nothing`", () => {
    expect(funcao("lancar_receita_mensalidade")).toMatch(
      /on conflict \(organization_id, origem_automatica\) where origem_automatica is not null do nothing/,
    );
    expect(funcao("lancar_receita_cobranca_avulsa")).toMatch(
      /on conflict \(organization_id, origem_automatica\) where origem_automatica is not null do nothing/,
    );
    expect(funcao("enfileirar_nota_fiscal")).toMatch(/on conflict \(origem, origem_id\) do nothing/);
  });
});

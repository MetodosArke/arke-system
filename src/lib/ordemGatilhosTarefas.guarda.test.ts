import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Trava estrutural contra uma dependência que quebra sem dar erro.
 *
 * O SLA da célula de Mentor é reescrito em horas úteis por
 * `trg_ultimo_sla_util_mentor`, um `before insert` em `tarefas`. Ele depende de
 * dois valores que **outros** gatilhos `before insert` da mesma tabela
 * definem: `trg_definir_dono_da_tarefa` decide se a tarefa é da ArkeFit, e
 * `trg_tarefas_bump_prioridade_elite` pode subir a prioridade — e é a
 * prioridade que escolhe o prazo.
 *
 * O PostgreSQL dispara gatilhos do mesmo evento **em ordem alfabética**. Por
 * isso o nome começa com `trg_ultimo_`: ele ordena depois de `trg_definir_` e
 * de `trg_tarefas_`. Um gatilho novo chamado `trg_validar_algo` ou
 * `trg_zerar_x` passaria a rodar **depois** dele e o SLA seria calculado a
 * partir de um valor que ainda ia mudar.
 *
 * O que torna isto digno de um teste é que **não dá erro**: a inserção
 * funciona, o painel enche, e o prazo só está errado. Ninguém descobre olhando
 * a tela; descobre quando a academia reclama de um SLA que o painel jurava
 * estar sendo cumprido.
 */

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const SENTINELA = "trg_ultimo_sla_util_mentor";

/** `create trigger <nome> before insert ... on ... tarefas` */
const CRIACAO =
  /create\s+trigger\s+([a-z0-9_]+)\s+([\s\S]{0,200}?)\bon\s+(?:public\.)?tarefas\b/gi;

function gatilhosBeforeInsertEmTarefas(): string[] {
  const nomes = new Set<string>();
  for (const arquivo of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, arquivo), "utf8");
    for (const m of sql.matchAll(CRIACAO)) {
      const [, nome, meio] = m;
      // Só os `before insert`: um `after` ou um `before update` não disputa
      // ordem com este cálculo.
      if (/\bbefore\b/i.test(meio) && /\binsert\b/i.test(meio)) nomes.add(nome.toLowerCase());
    }
  }
  return [...nomes];
}

describe("ordem dos gatilhos before insert de tarefas", () => {
  it("o gatilho do SLA em horas úteis existe e se chama trg_ultimo_*", () => {
    const nomes = gatilhosBeforeInsertEmTarefas();
    expect(nomes).toContain(SENTINELA);
    expect(SENTINELA.startsWith("trg_ultimo_")).toBe(true);
  });

  it("nenhum outro gatilho before insert ordena depois dele", () => {
    const depois = gatilhosBeforeInsertEmTarefas()
      .filter((n) => n !== SENTINELA && n > SENTINELA)
      .sort();

    expect(
      depois,
      `Estes gatilhos disparam DEPOIS de ${SENTINELA} e podem alterar dono ou ` +
        `prioridade tarde demais, deixando o SLA da célula errado sem nenhum erro: ` +
        `${depois.join(", ")}. Renomeie-os para ordenar antes, ou mova o cálculo.`,
    ).toEqual([]);
  });
});

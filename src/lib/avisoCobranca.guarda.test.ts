import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rotinasDoRepositorio } from "../../scripts/migracao/rotinas.mjs";
import { emHorarioComercial } from "../../supabase/functions/aviso-cobranca-atrasada/regras";

/**
 * Trava da recuperação da mensalidade vencida (15/10/2026).
 *
 * - O aviso é reservado no banco antes de sair, por uma atualização
 *   condicional: a coluna da etapa vazia e a mensalidade em aberto. Sem a
 *   condição, duas rodadas mandam o aviso duas vezes, e o aviso sai para
 *   quem acabou de pagar.
 * - A rotina roda no horário comercial de Brasília. O pg_cron agenda em GMT:
 *   "0 10 * * *" seria 7h da manhã do aluno.
 * - A tarefa fecha também quando a mensalidade nasce paga (o upsert do webhook).
 * - Só a rotina (service role, sem sessão) grava as colunas do aviso.
 */
const RAIZ = join(__dirname, "..", "..");
const funcao = readFileSync(join(RAIZ, "supabase", "functions", "aviso-cobranca-atrasada", "index.ts"), "utf8");
const migrations = readdirSync(join(RAIZ, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8").toLowerCase().replace(/\r\n/g, "\n"));

/** A hora em Brasília (UTC-3, sem horário de verão desde 2019) de um agendamento diário do pg_cron. */
export function horaEmBrasilia(agendamento: string): number | null {
  const m = /^(\d+) (\d+) \* \* \*$/.exec(agendamento.trim());
  return m ? (Number(m[2]) - 3 + 24) % 24 : null;
}

/** A reserva acontece antes do envio, com as duas condições. */
export function reservaAntesDoEnvio(codigo: string): boolean {
  const reserva = codigo.search(/\.update\(\{ \[coluna\]:[\s\S]*?\.is\(coluna, null\)[\s\S]*?\.in\("status", \["pendente", "atrasado"\]\)/);
  const envio = codigo.indexOf("enviarAvisos(");
  return reserva >= 0 && envio > reserva;
}

describe("o aviso da mensalidade vencida", () => {
  it("é reservado no banco antes de sair, e só para a mensalidade em aberto", () => {
    expect(reservaAntesDoEnvio(funcao)).toBe(true);
    // O detector detecta: sem a condição da coluna vazia, ou com o envio antes.
    expect(reservaAntesDoEnvio(funcao.replace(".is(coluna, null)", ""))).toBe(false);
    expect(reservaAntesDoEnvio('enviarAvisos(a);\n.update({ [coluna]: x }).is(coluna, null).in("status", ["pendente", "atrasado"])')).toBe(false);
  });

  it("a rotina roda no horário comercial de Brasília, todo dia", () => {
    const rotina = rotinasDoRepositorio(RAIZ).find((r) => r.nome === "arke-aviso-cobranca");
    expect(rotina?.comando).toContain("/functions/v1/aviso-cobranca-atrasada");
    const hora = horaEmBrasilia(rotina?.agendamento ?? "");
    expect(hora, rotina?.agendamento).not.toBeNull();
    expect(emHorarioComercial({ hora: hora!, diaDaSemana: 1 }), `${rotina?.agendamento} é ${hora}h em Brasília`).toBe(true);
    expect(horaEmBrasilia("0 10 * * *"), "o detector detecta").toBe(7);
    // Lê todas as migrations e o histórico: com a máquina carregada, passa dos 5 s.
  }, 30_000);

  it("a tarefa de cobrança fecha também quando a mensalidade nasce paga", () => {
    let gatilho = "";
    for (const sql of migrations) {
      for (const m of sql.match(/create trigger trg_fechar_tarefa_da_mensalidade_paga\s+after [a-z ]+ on public\.mensalidades/g) ?? []) gatilho = m;
    }
    expect(gatilho).toMatch(/after insert or update of status on/);
  });

  it("só a rotina grava quando o aviso saiu: a equipe, pela API, não", () => {
    // A regra de alteração de `mensalidades` é da gestão e da recepção; sem a
    // trava, elas suprimiriam o aviso ou inflariam o recuperado do Financeiro.
    let gatilho = "";
    let funcao = "";
    for (const sql of migrations) {
      for (const m of sql.match(/create trigger trg_aviso_de_cobranca_so_da_rotina\s+before [a-z0-9_, ]+ on public\.mensalidades/g) ?? []) gatilho = m;
      for (const m of sql.match(/create or replace function public\.aviso_de_cobranca_so_da_rotina\(\)[\s\S]*?\n\$\$;/g) ?? []) funcao = m;
    }
    expect(gatilho).toMatch(/before insert or update of aviso_cobranca_d1_em, aviso_cobranca_d3_em on/);
    expect(funcao).toMatch(/if auth\.uid\(\) is null then\s+return new;/);
    expect(funcao).toMatch(/errcode = '42501'/);
    expect(migrations.join("\n")).toMatch(/revoke execute on function public\.aviso_de_cobranca_so_da_rotina\(\) from public, anon, authenticated;/);
  });
});

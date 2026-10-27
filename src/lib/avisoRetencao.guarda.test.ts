import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rotinasDoRepositorio } from "../../scripts/migracao/rotinas.mjs";
import { dentroDoHorario } from "../../supabase/functions/aviso-retencao-aluno/regras";

/**
 * Trava dos avisos de retenção ao aluno (26/10/2026).
 *
 * - O aviso é reservado no banco antes de sair: sem a reserva, duas rodadas
 *   mandam o mesmo aviso, e um aviso que falhou no meio sai de novo amanhã.
 * - A rotina roda dentro da janela das 8h às 20h de Brasília. O pg_cron
 *   agenda em GMT: "30 10 * * *" seria 7h30 do aluno.
 * - Só a rotina (service role, sem sessão) grava a marca do aviso na tarefa.
 * - A tarefa de faltas fecha quando o aluno treina pelo app e pela catraca, e
 *   só a que tem o aviso automático.
 * - Quem pode receber é o aluno em dia (o inadimplente recebe só o aviso de
 *   cobrança), não anonimizado e com a matrícula ativa.
 */
const RAIZ = join(__dirname, "..", "..");
const funcao = readFileSync(join(RAIZ, "supabase", "functions", "aviso-retencao-aluno", "index.ts"), "utf8");
const migrations = readdirSync(join(RAIZ, "supabase", "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(RAIZ, "supabase", "migrations", f), "utf8").toLowerCase().replace(/\r\n/g, "\n"));
const todas = migrations.join("\n");

/** A hora em Brasília (UTC-3, sem horário de verão desde 2019) de um agendamento diário do pg_cron. */
function horaEmBrasilia(agendamento: string): number | null {
  const m = /^(\d+) (\d+) \* \* \*$/.exec(agendamento.trim());
  return m ? (Number(m[2]) - 3 + 24) % 24 : null;
}

/** A última versão de uma função do banco nas migrations. */
function ultimaVersao(nome: string): string {
  let texto = "";
  for (const sql of migrations) {
    for (const m of sql.match(new RegExp(`create or replace function public\\.${nome}\\([\\s\\S]*?\\n\\$\\$;`, "g")) ?? []) texto = m;
  }
  return texto;
}

/** A reserva vem antes de qualquer envio, e o envio só acontece para a reserva concedida. */
export function reservaAntesDoEnvio(codigo: string): boolean {
  const reserva = codigo.indexOf('admin.rpc("reservar_aviso_ao_aluno"');
  const descarta = codigo.indexOf("if (!reserva) continue;");
  const envios = [codigo.indexOf("api.resend.com"), codigo.indexOf("enviarAvisos(")];
  return reserva >= 0 && descarta > reserva && envios.every((e) => e > descarta);
}

describe("os avisos de retenção ao aluno", () => {
  it("são reservados no banco antes de sair", () => {
    expect(reservaAntesDoEnvio(funcao)).toBe(true);
    // O detector detecta: sem descartar a reserva negada, ou com o envio antes.
    expect(reservaAntesDoEnvio(funcao.replace("if (!reserva) continue;", ""))).toBe(false);
    expect(reservaAntesDoEnvio('enviarAvisos(a);\nadmin.rpc("reservar_aviso_ao_aluno"\nif (!reserva) continue;\napi.resend.com')).toBe(false);
  });

  it("a reserva é uma por aluno, tipo e período", () => {
    expect(todas).toMatch(/create table if not exists public\.avisos_ao_aluno[\s\S]*?unique \(aluno_id, tipo, referencia\)/);
    expect(ultimaVersao("reservar_aviso_ao_aluno")).toMatch(/on conflict \(aluno_id, tipo, referencia\) do nothing/);
  });

  it("a rotina roda entre 8h e 20h de Brasília, todo dia", () => {
    const rotina = rotinasDoRepositorio(RAIZ).find((r) => r.nome === "arke-aviso-retencao");
    expect(rotina?.comando).toContain("/functions/v1/aviso-retencao-aluno");
    const hora = horaEmBrasilia(rotina?.agendamento ?? "");
    expect(hora, rotina?.agendamento).not.toBeNull();
    expect(dentroDoHorario(hora!), `${rotina?.agendamento} é ${hora}h em Brasília`).toBe(true);
    expect(dentroDoHorario(horaEmBrasilia("30 10 * * *")!), "o detector detecta").toBe(false);
  }, 30_000);

  it("só a rotina grava a marca do aviso na tarefa: a equipe, pela API, não", () => {
    expect(todas).toMatch(/create trigger trg_aviso_automatico_so_da_rotina\s+before insert or update of aviso_automatico_em on public\.tarefas/);
    const guarda = ultimaVersao("aviso_automatico_so_da_rotina");
    expect(guarda).toMatch(/if auth\.uid\(\) is null then\s+return new;/);
    expect(guarda).toMatch(/errcode = '42501'/);
    expect(todas).toMatch(/revoke execute on function public\.aviso_automatico_so_da_rotina\(\) from public, anon, authenticated;/);
  });

  it("a tarefa de faltas fecha pelo treino no app e pela passagem na academia, só depois do aviso", () => {
    expect(todas).toMatch(/create trigger trg_fechar_tarefa_de_faltas_ao_treinar\s+after insert or update of concluido on public\.registro_treino/);
    expect(todas).toMatch(/create trigger trg_fechar_tarefa_de_faltas_ao_treinar\s+after insert on public\.presencas/);
    const fechar = ultimaVersao("fechar_tarefa_de_faltas_ao_treinar");
    expect(fechar).toMatch(/aviso_automatico_em is not null/);
    expect(fechar).toMatch(/tipo in \('barreira', 'inercia'\)/);
    expect(todas).toMatch(/revoke execute on function public\.fechar_tarefa_de_faltas_ao_treinar\(\) from public, anon, authenticated;/);
  });

  it("quem pode receber: em dia, liberado, não anonimizado, com a matrícula ativa; e só a rotina lê", () => {
    const quem = ultimaVersao("alunos_para_avisos_de_retencao");
    expect(quem).toMatch(/al\.anonimizado_em is null/);
    expect(quem).toMatch(/al\.situacao_academia = 'em_dia'/);
    expect(quem).toMatch(/public\.situacao_permite_app\(al\.situacao_academia, al\.situacao_academia_em\)/);
    expect(quem).toMatch(/m\.status = 'ativa'/);
    expect(todas).toMatch(/revoke execute on function public\.alunos_para_avisos_de_retencao\(\) from public, anon, authenticated;/);
    expect(todas).toMatch(/revoke execute on function public\.reservar_aviso_ao_aluno\(uuid, text, date, text\[\]\) from public, anon, authenticated;/);
  });
});

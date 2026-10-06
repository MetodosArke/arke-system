import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARCAS,
  PROJETO,
  ROTEIRO,
  blocoNoRoteiro,
  blocoRotinas,
  blocoTokens,
  chamadasCron,
  lerTexto,
  rotinasDoRepositorio,
  rotinasDoTexto,
  tokensDasRotinas,
} from "../../scripts/migracao/rotinas.mjs";

/**
 * Trava da decisão de 06/10/2026 (auditoria de prontidão): a lista das
 * rotinas do pg_cron mora num lugar só, as migrations que as agendam.
 *
 * O roteiro de reconstrução (`scripts/migracao/02-depois-da-restauracao.sql`)
 * desagenda tudo e recria as rotinas, porque o `cron.job` não sai no dump. A
 * lista dele era escrita à mão, com 14 rotinas (uma já desagendada), e mais
 * da metade das que as migrations agendam ficava de fora: a retenção dos
 * logs da catraca, os históricos, os leads, o Vigia e os encerramentos,
 * entre outras, sumiriam numa reconstrução. Agora o bloco é gerado por
 * `node scripts/migracao/rotinas.mjs --escrever`, e este teste falha quando
 * uma migration nova agenda (ou desagenda) uma rotina e o roteiro não foi
 * gerado de novo.
 */
const RAIZ = join(__dirname, "..", "..");
const roteiro = lerTexto(join(RAIZ, ROTEIRO));
const rotinas = rotinasDoRepositorio(RAIZ);

describe("rotinas do banco na reconstrução", () => {
  it("o roteiro recria exatamente as rotinas que as migrations e o histórico deixam agendadas", () => {
    const doRoteiro = rotinasDoTexto(roteiro).map((r) => `${r.nome} ${r.agendamento} ${r.comando}`).sort();
    const dasMigrations = rotinas.map((r) => `${r.nome} ${r.agendamento} ${r.comando}`).sort();
    expect(doRoteiro).toEqual(dasMigrations);
  });

  it("o bloco gerado está em dia (rode node scripts/migracao/rotinas.mjs --escrever)", () => {
    expect(blocoNoRoteiro(roteiro, MARCAS.rotinas)).toBe(blocoRotinas(rotinas));
    expect(blocoNoRoteiro(roteiro, MARCAS.tokens)).toBe(blocoTokens(tokensDasRotinas(rotinas)));
  });

  it("todo token do Vault que uma rotina lê nasce no roteiro", () => {
    const tokens = tokensDasRotinas(rotinas);
    expect(tokens).toContain("alerta_rotinas_token");
    for (const t of tokens) expect(roteiro).toContain(`'${t}', 'Autentica o pg_cron`);
  });

  it("as rotinas que a lista à mão esquecia estão na reconstrução", () => {
    const nomes = new Set(rotinas.map((r) => r.nome));
    for (const nome of [
      "arke-retencao-logs-catraca",
      "arke-retencao-historicos",
      "arke-retencao-leads-comerciais",
      "arke-vigia",
      "arke-vigia-analise",
      "arke-vigia-resumo",
      "arke-encerramentos",
      "arke-alerta-catracas",
      "arke-briefing-semanal",
      // As mais novas, agendadas pelas migrations depois da lista à mão.
      "arke-dados-de-passagem",
      "arke-remocoes-fim-de-matricula",
      "arke-registros-de-acesso",
      // Nasceu pelo roteiro antigo, sem migration que a agendasse no banco
      // de produção; agora nasce de 20261374010000.
      "snapshot-mrr-diario",
    ]) {
      expect(nomes.has(nome), nome).toBe(true);
    }
    // Saiu com a Letícia e o Bruno (20261315010000): não volta pela reconstrução.
    expect(nomes.has("arke-lembrete-onboarding")).toBe(false);
  });

  it("toda rotina chama as funções do projeto atual, nunca o anterior", () => {
    // As duas mais antigas do histórico (reconciliação do Asaas e alerta de
    // rotinas) chamavam o projeto anterior; em produção foram apontadas para
    // o atual na mudança de projeto, e a reconstrução as recriava erradas.
    const projetos = new Set(
      rotinas.flatMap((r) => [...r.comando.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/g)].map((m) => m[1])),
    );
    expect([...projetos]).toEqual([PROJETO]);
    expect(roteiro).not.toMatch(new RegExp(`https://(?!${PROJETO})[a-z0-9]{20}\\.supabase\\.co`));
  });

  it("nenhuma rotina repete nome", () => {
    const nomes = rotinas.map((r) => r.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("leitura das chamadas ao pg_cron", () => {
  it("entende as formas usadas nas migrations", () => {
    const sql = [
      "-- select cron.schedule('comentario', '* * * * *', 'select 1');",
      "select cron.unschedule(jobid) from cron.job where jobname = 'a';",
      "select cron.schedule('a', '17 * * * *', 'select public.f(''x'')');",
      "select cron.schedule(\n  'b',\n  '*/5 * * * *',\n  $cron$\n    select 2;\n  $cron$\n);",
      "do $$ begin perform cron.unschedule('c'); perform cron.schedule('c', '5 3 * * *', $x$select 3;$x$); end $$;",
      "select cron.unschedule('b');",
    ].join("\n");
    expect(rotinasDoTexto(sql)).toEqual([
      { nome: "a", agendamento: "17 * * * *", comando: "select public.f('x')" },
      { nome: "c", agendamento: "5 3 * * *", comando: "select 3;" },
    ]);
  });

  it("desagendar tudo zera a lista", () => {
    const sql = "select cron.schedule('a', '0 * * * *', 'select 1');\nselect cron.unschedule(jobid) from cron.job;";
    expect(rotinasDoTexto(sql)).toEqual([]);
  });

  it("forma que o leitor não entende é erro, e não rotina sumida", () => {
    expect(() => chamadasCron("select cron.schedule('a', '0 * * * *', public.comando());", "x.sql")).toThrow(/x\.sql:1/);
    expect(() => chamadasCron("select cron.unschedule(jobid) from cron.job where jobname like 'a%';", "y.sql")).toThrow(/y\.sql:1/);
  });
});

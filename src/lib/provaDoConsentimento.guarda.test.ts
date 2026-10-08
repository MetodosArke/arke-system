import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROPOSITOS_RESPONSAVEL } from "./menorDeIdade";
import { VERSAO_DO_PROPOSITO, textoCanonico } from "./textosConsentimento";

/**
 * A prova do consentimento (auditoria de prontidão, 07/10/2026): quem
 * aceitou, quando, qual texto (versão e SHA-256) e de onde (o navegador). O
 * achado era que o próprio aluno gravava os campos que provam o consentimento
 * dele: a finalidade, a versão, a data e a origem. Migration
 * `20261410010000_prova_do_consentimento.sql`; a prova no banco está nos
 * roteiros da frente E.
 *
 * Esta guarda trava, sem banco:
 * - o hash de cada texto vigente está na tabela do banco
 *   (`hash_texto_consentimento`), calculado do texto que o app mostra;
 * - a API só manda, nos consentimentos de IA e de biometria, as colunas que
 *   são do aluno escolher, e nenhuma migration depois devolve o resto;
 * - a tela do aluno não manda o que o banco carimba;
 * - o aceite do responsável leva o navegador do cabeçalho;
 * - nenhum consentimento guarda IP (Política, seção 7: IP só nos registros de
 *   acesso, por 6 meses).
 */

const RAIZ = join(__dirname, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const migrations = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const ler = (n: string) => readFileSync(join(MIGRATIONS, n), "utf8");
const PROVA = "20261410010000_prova_do_consentimento.sql";

/** A última definição de uma função nas migrations. */
function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(String.raw`create or replace function public\.${funcao}\([\s\S]*?\n\$\$;`, "g");
  let achada = "";
  for (const m of migrations) for (const d of ler(m).match(re) ?? []) achada = d;
  return achada;
}

describe("o hash do texto de cada consentimento", () => {
  const tabela = ultimaDefinicao("hash_texto_consentimento");

  it.each(PROPOSITOS_RESPONSAVEL)("%s: a versão vigente do app está na tabela do banco, com o hash do texto que o app mostra", (p) => {
    expect(tabela, "hash_texto_consentimento não achada nas migrations").not.toBe("");
    const linha = new RegExp(String.raw`when '${p}@${VERSAO_DO_PROPOSITO[p].replace(/\./g, "\\.")}' then '([0-9a-f]{64})'`).exec(tabela);
    expect(linha, `falta '${p}@${VERSAO_DO_PROPOSITO[p]}' em hash_texto_consentimento: texto novo pede a linha nova`).not.toBeNull();
    expect(linha![1]).toBe(sha256(textoCanonico(p)));
  });
});

describe("o que a API grava nos consentimentos", () => {
  const COLUNAS_DA_API: Record<string, { insert: string[]; update: string[] }> = {
    aluno_consentimento_ia: { insert: ["organization_id", "aluno_id", "proposito"], update: ["revogado_em"] },
    aluno_consentimento_biometrico: { insert: ["organization_id", "aluno_id"], update: [] },
  };

  it.each(Object.entries(COLUNAS_DA_API))("%s: a migration dá à API só as colunas do aluno", (tabela, esperado) => {
    const sql = ler(PROVA);
    expect(sql).toMatch(new RegExp(String.raw`revoke insert, update, delete on public\.${tabela} from anon, authenticated;`));
    const insert = new RegExp(String.raw`grant insert \(([^)]*)\) on public\.${tabela} to authenticated;`).exec(sql);
    expect(insert?.[1].split(",").map((c) => c.trim()).sort()).toEqual([...esperado.insert].sort());
    const update = new RegExp(String.raw`grant update \(([^)]*)\) on public\.${tabela} to authenticated;`).exec(sql);
    expect(update?.[1].split(",").map((c) => c.trim()).sort() ?? []).toEqual([...esperado.update].sort());
  });

  it("nenhuma migration depois devolve à API a tabela inteira", () => {
    const depois = migrations.filter((n) => n > PROVA);
    const devolve = /grant\s+(all|insert|update)(\s*,\s*\w+)*\s+on\s+(table\s+)?public\.(aluno_consentimento_ia|aluno_consentimento_biometrico)\s+to\s+[^;]*\b(authenticated|anon)\b/i;
    expect(depois.filter((n) => devolve.test(ler(n)))).toEqual([]);
  });

  it("os gatilhos carimbam a data, a versão, o hash e o navegador, e não são security definer (precisam ver quem grava)", () => {
    for (const funcao of ["prova_consentimento_ia", "prova_consentimento_biometrico", "prova_consentimento_saude", "prova_aceite_documento"]) {
      const def = ultimaDefinicao(funcao);
      expect(def, funcao).not.toBe("");
      expect(def, funcao).not.toMatch(/security definer/);
      expect(def, funcao).toMatch(/navegador_da_requisicao\(\)/);
    }
    expect(ultimaDefinicao("prova_consentimento_ia")).toMatch(/new\.aceito_em := now\(\)/);
    expect(ultimaDefinicao("prova_consentimento_ia")).toMatch(/new\.revogado_por := auth\.uid\(\)/);
    expect(ultimaDefinicao("prova_consentimento_biometrico")).toMatch(/new\.origem := 'app'/);
    expect(ultimaDefinicao("prova_consentimento_saude")).toMatch(/new\.consentimento_lgpd_aceito_em := now\(\)/);
  });

  it("o navegador vem do cabeçalho só para a sessão de uma pessoa", () => {
    const def = ultimaDefinicao("navegador_da_requisicao");
    expect(def).toMatch(/request\.headers/);
    expect(def).toMatch(/not in \('authenticated', 'anon'\)/);
  });
});

describe("a tela e as funções", () => {
  it("a tela de IA do aluno só manda o aluno, a academia e o propósito, e para retirar só a data", () => {
    const tela = readFileSync(join(RAIZ, "src", "components", "sentinela", "SentinelaAnamnese.tsx"), "utf8");
    const inserts = [...tela.matchAll(/from\("aluno_consentimento_ia"\)\s*\.insert\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    const updates = [...tela.matchAll(/from\("aluno_consentimento_ia"\)\s*\.update\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(inserts.length).toBeGreaterThan(0);
    for (const corpo of inserts) {
      const chaves = corpo.split(",").map((c) => c.split(":")[0].trim()).filter(Boolean);
      expect(chaves.every((c) => ["aluno_id", "organization_id", "proposito"].includes(c)), corpo).toBe(true);
    }
    for (const corpo of updates) expect(corpo.split(":")[0].trim()).toBe("revogado_em");
  });

  it("o aceite do responsável leva o navegador do cabeçalho", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "responsavel-aceite", "index.ts"), "utf8");
    expect(funcao).toMatch(/_user_agent: req\.headers\.get\("user-agent"\)/);
    expect(ultimaDefinicao("registrar_aceite_responsavel")).toMatch(/hash_texto_consentimento\(v_prop/);
  });

  it("nenhum consentimento guarda IP", () => {
    const sql = ler(PROVA);
    expect(sql).not.toMatch(/add column (if not exists )?\w*ip\w*\s/i);
    expect(sql).not.toMatch(/x-forwarded-for|cf-connecting-ip|inet_client_addr/i);
  });
});

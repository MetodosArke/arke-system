import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava da auditoria de 05/10/2026: as duas etapas da gestão valem no banco.
 *
 * Quem ligava "pedir o código na entrada do painel" e tinha só a senha lia
 * tudo pela API: a regra morava na tela. Agora uma regra restritiva por tabela
 * com dado de pessoa (`"duas etapas"`, 20261363010000) exige a sessão
 * verificada de quem tem um aplicativo autenticador. A conferência fica fora
 * das funções de papel de propósito: lá ela rodaria a cada linha (+50% de
 * páginas lidas, medido), e na regra restritiva, com `(select ...)`, roda uma
 * vez por consulta.
 *
 * Falha se uma tabela com `aluno_id` ficar sem a regra (tabela nova entra na
 * lista, ou numa migration que cria a regra nela), se a regra deixar de ser
 * restritiva ou passar a rodar por linha, ou se a função perder uma das três
 * condições.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8").replace(/\r\n/g, "\n").toLowerCase();
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const HISTORICO = join(RAIZ, "supabase", "historico");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(MIGRATIONS, f) }));
const historico = readdirSync(HISTORICO)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(HISTORICO, f) }));

const MIGRATION = "20261363010000_duas_etapas_no_banco.sql";

/** Tabelas com `aluno_id`, pelo histórico e pelas migrations (criadas e não apagadas). */
function tabelasComAluno(): Set<string> {
  const tabelas = new Set<string>();
  for (const m of [...historico, ...migrations]) {
    for (const c of m.sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
      if (/\baluno_id\b/.test(c[2])) tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\s+add column (?:if not exists )?aluno_id\b/g)) {
      tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/g)) tabelas.delete(c[1]);
  }
  return tabelas;
}

/** As tabelas com a regra: a lista da migration e as que ganham a regra depois dela. */
function tabelasComARegra(): Set<string> {
  const sql = migrations.find((m) => m.nome === MIGRATION)?.sql ?? "";
  const lista = sql.match(/foreach t in array array\[([\s\S]*?)\]/)?.[1] ?? "";
  const tabelas = new Set([...lista.matchAll(/'(\w+)'/g)].map((m) => m[1]));
  for (const m of migrations.filter((m) => m.nome >= MIGRATION)) {
    for (const c of m.sql.matchAll(/create policy "duas etapas" on public\.(\w+) as restrictive/g)) tabelas.add(c[1]);
  }
  return tabelas;
}

describe("duas etapas no banco", () => {
  it("toda tabela com dado de aluno tem a regra, e o dinheiro da equipe também", () => {
    const comAluno = tabelasComAluno();
    expect(comAluno.size, "o detector detecta").toBeGreaterThan(30);
    const comRegra = tabelasComARegra();
    expect([...comAluno].filter((t) => !comRegra.has(t)).sort(), "ponha a tabela na regra \"duas etapas\"").toEqual([]);
    for (const t of ["alunos", "profiles", "leads", "lancamentos_financeiros", "staff_folha", "pagamentos"]) {
      expect(comRegra.has(t), t).toBe(true);
    }
  });

  it("a regra é restritiva e roda uma vez por consulta", () => {
    const sql = migrations.find((m) => m.nome === MIGRATION)?.sql ?? "";
    expect(sql).toMatch(/as restrictive for all to authenticated/);
    expect(sql).toMatch(/using \(\(select public\.sessao_cumpre_duas_etapas\(\)\)\)/);
    expect(sql).toMatch(/with check \(\(select public\.sessao_cumpre_duas_etapas\(\)\)\)/);
    // O perfil da própria pessoa passa: o app lê o nome antes de pedir o código.
    expect(sql).toMatch(/on public\.profiles as restrictive for all to authenticated\s+using \(user_id = \(select auth\.uid\(\)\) or \(select public\.sessao_cumpre_duas_etapas\(\)\)\)/);
  });

  it("a conferência não entrou nas funções de papel (custaria por linha)", () => {
    const depois = migrations.filter((m) => m.nome >= MIGRATION).map((m) => m.sql).join("\n");
    for (const f of ["is_org_staff", "has_org_role", "is_org_member", "cuida_do_dinheiro", "atende_saude"]) {
      const re = new RegExp(`create or replace function public\\.${f}\\s*\\([\\s\\S]*?\\$\\$;`, "g");
      for (const corpo of depois.match(re) ?? []) expect(corpo, f).not.toMatch(/mfa_factors|sessao_cumpre_duas_etapas/);
    }
  });

  it("quem ligou as duas etapas passa só verificado; quem não ligou e a sessão simulada passam", () => {
    const sql = migrations.find((m) => m.nome === MIGRATION)?.sql ?? "";
    const corpo = sql.match(/create or replace function public\.sessao_cumpre_duas_etapas\(\)[\s\S]*?\$\$;/)?.[0] ?? "";
    expect(corpo).toMatch(/->> 'aal', ''\) = 'aal2'/);
    expect(corpo).toMatch(/not exists \(\s*select 1 from auth\.mfa_factors f\s+where f\.user_id = \(select auth\.uid\(\)\) and f\.status = 'verified'/);
    expect(corpo).toMatch(/or public\.sessao_simulada\(\)/);
    expect(sql).toMatch(/revoke execute on function public\.sessao_cumpre_duas_etapas\(\) from public, anon/);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CPF se compara sem máscara.
 *
 * Três funções gravavam o CPF como foi digitado, e a catraca procurava só os
 * dígitos: o aluno com "123.456.789-09" não era achado, e o mesmo CPF com e
 * sem máscara passava pelo índice único como duas pessoas (auditoria de
 * 05/10/2026). O banco agora guarda só os dígitos (`trg_cpf_sem_mascara`,
 * migration 20261368010000). Esta trava pega o código novo que compara CPF
 * sem tirar a máscara do outro lado:
 *
 * - filtro do supabase-js na coluna `cpf` (`.eq("cpf", x)`, `.in`, `.match`,
 *   `.or("cpf.eq...")`) com um valor que não passou por um normalizador;
 * - comparação `===`/`!==` de uma variável de CPF que não foi normalizada;
 * - nas migrations novas, `cpf = ...` sem `cpf_sem_mascara` ou `regexp_replace`.
 *
 * Normalizado é o valor que passou por `somenteDigitos`, `soDigitos`,
 * `digitos`, `cpfSemMascara` ou `.replace(/\D/g, "")` — na mesma expressão
 * ou na declaração da variável.
 */
const RAIZ = join(__dirname, "..", "..");
const PASTAS = [join(RAIZ, "src"), join(RAIZ, "supabase", "functions"), join(RAIZ, "packages", "gateway", "src")];
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const DESDE = "20261365010000";

const NORMALIZADOR = /somenteDigitos\(|soDigitos\(|\bdigitos\(|cpfSemMascara\(|\.replace\(\s*\/\\D\/g/;

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "node_modules" || nome === "dist" ? [] : arquivos(caminho);
    if (!/\.(ts|tsx|mjs)$/.test(nome) || /\.test\.tsx?$/.test(nome) || nome === "types.ts") return [];
    return [caminho];
  });
}

/** A expressão está normalizada, ou é uma variável declarada já normalizada no mesmo arquivo. */
function normalizado(expr: string, fonte: string): boolean {
  const e = expr.trim();
  if (NORMALIZADOR.test(e)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(e)) return false;
  const declaracoes = [...fonte.matchAll(new RegExp(`(?:const|let|var)\\s+${e.replace(/\$/g, "\\$")}\\s*(?::[^=\\n]+)?=\\s*([^;\\n]+)`, "g"))];
  return declaracoes.length > 0 && declaracoes.every((d) => NORMALIZADOR.test(d[1]));
}

const LITERAL = /^(?:["'`].*["'`]|\d+|null|undefined|true|false)$/;

/** Problemas de comparação de CPF num arquivo de código. */
function problemasNoCodigo(fonte: string): string[] {
  const problemas: string[] = [];
  // 1. Filtro do supabase-js na coluna cpf.
  for (const m of fonte.matchAll(/\.(?:eq|neq|in)\(\s*["']cpf["']\s*,\s*([^)]+)\)/g)) {
    if (!normalizado(m[1], fonte)) problemas.push(m[0]);
  }
  for (const m of fonte.matchAll(/\.match\(\s*\{[^}]*\bcpf\s*:\s*([^,}]+)/g)) {
    if (!normalizado(m[1], fonte)) problemas.push(m[0]);
  }
  for (const m of fonte.matchAll(/\.(?:or|filter)\(\s*[`"'][^`"']*\bcpf\.(?:eq|in|ilike|like)\.\$\{([^}]+)\}/g)) {
    if (!normalizado(m[1], fonte)) problemas.push(m[0]);
  }
  // 2. Comparação de igualdade com uma variável de CPF.
  const operando = String.raw`[\w$][\w$.?\[\]]*`;
  for (const m of fonte.matchAll(new RegExp(`(${operando})\\s*(===|!==|==|!=)\\s*(${operando}|["'\`][^"'\`]*["'\`])`, "g"))) {
    const [, a, , b] = m;
    const deCpf = (x: string) => /cpf/i.test(x) && !/\.length$/.test(x) && !LITERAL.test(x);
    if (!deCpf(a) && !deCpf(b)) continue;
    if (LITERAL.test(a) || LITERAL.test(b) || /\.length$/.test(a) || /\.length$/.test(b)) continue;
    if (!normalizado(a, fonte) || !normalizado(b, fonte)) problemas.push(m[0]);
  }
  return problemas;
}

/** Problemas de comparação de CPF numa migration. */
function problemasNaMigration(sql: string): string[] {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .filter((l) => /\bcpf\w*\s*(?:=|<>|!=)(?!\s*null\b)/i.test(l) || /(?<![:<>!])=\s*[\w.]*\bcpf\w*\b/i.test(l))
    .filter((l) => !/cpf_sem_mascara\(|regexp_replace\(/i.test(l));
}

describe("CPF se compara sem máscara", () => {
  it("o detector detecta", () => {
    expect(problemasNoCodigo(`await admin.from("profiles").select("id").eq("cpf", payload.cpf)`)).toHaveLength(1);
    expect(problemasNoCodigo(`const cpf = payload.cpf?.trim();\nawait q.eq("cpf", cpf)`)).toHaveLength(1);
    expect(problemasNoCodigo(`const cpf = somenteDigitos(payload.cpf);\nawait q.eq("cpf", cpf)`)).toEqual([]);
    expect(problemasNoCodigo(`await q.eq("cpf", payload.cpf.replace(/\\D/g, ""))`)).toEqual([]);
    expect(problemasNoCodigo(`if (perfil.cpf === cpfDigitado) {}`)).toHaveLength(1);
    expect(problemasNoCodigo(`const a = (x ?? "").replace(/\\D/g, "");\nconst cpfB = soDigitos(y);\nif (a !== cpfB) {}`)).toEqual([]);
    expect(problemasNoCodigo(`if (credencial.tipo === "cpf" || cpf.length !== 11 || form.cpf === "") {}`)).toEqual([]);
    expect(problemasNoCodigo('await q.or(`cpf.eq.${valor},email.eq.${email}`)')).toHaveLength(1);
    expect(problemasNaMigration("  where p.cpf = _cpf")).toHaveLength(1);
    expect(problemasNaMigration("  where p.cpf = public.cpf_sem_mascara(_cpf)")).toEqual([]);
    expect(problemasNaMigration("  new.cpf := public.cpf_sem_mascara(new.cpf);\n  set full_name = 'x', cpf = null")).toEqual([]);
  });

  it("nenhum código compara CPF sem tirar a máscara", () => {
    const achados = PASTAS.flatMap((pasta) =>
      arquivos(pasta).flatMap((arquivo) => {
        const fonte = readFileSync(arquivo, "utf8");
        // Só o arquivo que fala de CPF passa pelas expressões, que são caras.
        if (!/cpf/i.test(fonte)) return [];
        return problemasNoCodigo(fonte).map((p) => `${relative(RAIZ, arquivo)}: ${p}`);
      }),
    );
    expect(achados).toEqual([]);
  }, 30_000);

  it("nenhuma migration nova compara CPF sem tirar a máscara", () => {
    const achados = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= DESDE)
      .flatMap((f) => problemasNaMigration(readFileSync(join(MIGRATIONS, f), "utf8")).map((l) => `${f}: ${l.trim()}`));
    expect(achados).toEqual([]);
  });

  it("o banco guarda o CPF sem máscara, em profiles e no registro da catraca", () => {
    const sql = readFileSync(join(MIGRATIONS, "20261368010000_cpf_so_digitos.sql"), "utf8");
    expect(sql).toMatch(/create trigger trg_cpf_sem_mascara\s+before insert or update of cpf on public\.profiles/);
    expect(sql).toMatch(/create trigger trg_cpf_sem_mascara\s+before insert or update of cpf_consultado on public\.acessos_catraca_logs/);
  });
});

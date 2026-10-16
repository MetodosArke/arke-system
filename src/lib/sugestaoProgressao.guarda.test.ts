import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { dividir, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";

/**
 * Trava da sugestão de progressão da carga (16/10/2026).
 *
 * A sugestão deriva de dado de saúde (dor, sono, energia, esforço) e é para
 * quem prescreve o treino. Ela é calculada na tela, pelo que o RLS de quem
 * olha devolve, e não é gravada nem servida por função própria. Então o que a
 * garante é:
 *
 * - a tela só lê, e só pela API das tabelas (o RLS de quem pede): nada de
 *   gravação, de função do banco (`security definer` entregaria o que o RLS
 *   esconde) ou de função publicada;
 * - a tela pergunta o papel antes de ler e o dono do treino antes de mostrar;
 * - o aluno não a vê: nenhuma tela do app do aluno a importa;
 * - o sono e a energia continuam só com quem atende a saúde (sem a recepção)
 *   e com a mentoria no Método;
 * - o Mentor lê as séries do aluno do Método, e só dele.
 */
const RAIZ = join(__dirname, "..");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");
const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const TELA = ler("components", "prescricao", "SugestaoProgressao.tsx");
const REGRA = ler("lib", "sugestaoProgressao.ts");
const EDITOR = ler("components", "prescricao", "PrescricaoTreino.tsx");
const textos = textosDaReconstrucao().map((t: string) => t.replace(/\r\n/g, "\n"));

/** O que a tela faz de diferente de ler uma tabela pela API. */
export function escritasOuFuncoes(codigo: string): string[] {
  return [...semComentarios(codigo).matchAll(/\.(insert|update|upsert|delete|rpc)\(|\.functions\.invoke\b|\.storage\b/g)].map((m) => m[0]);
}

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** Os termos (ligados por OU) da regra de leitura vigente da tabela. */
function termosDaLeitura(tabela: string, sqls: string[] = textos): string[] {
  const leitura = [...regrasVigentes(sqls, `public.${tabela}`)].filter(([, r]) => !r.restritiva && (r.comando === "select" || r.comando === "all"));
  expect(leitura.length, `${tabela}: uma regra de leitura`).toBe(1);
  return dividir(leitura[0][1].using, "or");
}

/** Os termos da leitura que abrem a tabela à equipe do Método sem pedir o aluno do Método. */
function metodoSemAluno(tabela: string, sqls: string[] = textos): string[] {
  return termosDaLeitura(tabela, sqls).filter((t) => /equipe_metodo\(\)/.test(t) && !/aluno_no_metodo\(/.test(t));
}

describe("a sugestão de progressão só lê, pelo RLS de quem olha", () => {
  it("a tela e a regra não gravam, não chamam função do banco nem função publicada", () => {
    expect(escritasOuFuncoes(TELA)).toEqual([]);
    expect(escritasOuFuncoes(REGRA)).toEqual([]);
  });

  it("o detector acha a gravação e a função (a trava trava)", () => {
    expect(escritasOuFuncoes(`await supabase.from("treinos").update({ status: "x" });`)).toEqual([".update("]);
    expect(escritasOuFuncoes(`await supabase.rpc("sugestao_progressao", { _aluno_id: id });`)).toEqual([".rpc("]);
    expect(escritasOuFuncoes(`// supabase.rpc("comentado")`)).toEqual([]);
  });

  it("a tela pergunta o papel antes de ler, e o dono do treino antes de mostrar", () => {
    const codigo = semComentarios(TELA);
    expect(codigo).toMatch(/const podeVer = papelVeSugestao\(contexto\)/);
    expect(codigo).toMatch(/enabled:\s*podeVer\b/);
    expect(codigo).toMatch(/if \(!podeVer\) return null;/);
    expect(codigo).toMatch(/if \(!veSugestaoDeProgressao\(\{ \.\.\.contexto, alunoNoMetodo: data\.alunoNoMetodo \}\)\) return null;/);
  });

  it("aparece num lugar só: o editor de treino, com o aluno escolhido", () => {
    const quemImporta = arquivos(RAIZ)
      .filter((f) => /from\s+"@\/components\/prescricao\/SugestaoProgressao"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(RAIZ, f).replace(/\\/g, "/"));
    expect(quemImporta).toEqual(["components/prescricao/PrescricaoTreino.tsx"]);
    expect(EDITOR).toMatch(/\{alunoPublicar && <SugestaoProgressao alunoId=\{alunoPublicar\} escopo=\{escopo\.tipo\} \/>\}/);
  });

  it("o aluno não vê: nada do app do aluno importa a regra nem a tela", () => {
    const doAluno = [...arquivos(join(RAIZ, "pages", "app")), ...arquivos(join(RAIZ, "components", "aluno"))];
    const importam = doAluno
      .filter((f) => /sugestaoProgressao|SugestaoProgressao/.test(readFileSync(f, "utf8")))
      .map((f) => relative(RAIZ, f).replace(/\\/g, "/"));
    expect(importam).toEqual([]);
  });
});

describe("as regras do banco que a sugestão pressupõe", () => {
  it("sono e energia: quem atende a saúde e a mentoria no Método; a recepção, não", () => {
    const termos = termosDaLeitura("registro_treino_bem_estar");
    expect(termos.some((t) => /^atende_saude\(organization_id\)$/.test(t))).toBe(true);
    expect(termos.join(" or ")).not.toMatch(/is_org_staff/);
    expect(metodoSemAluno("registro_treino_bem_estar")).toEqual([]);
  });

  it("as séries: o Mentor lê as do aluno do Método, uma vez por consulta, e só dele", () => {
    const termos = termosDaLeitura("registro_serie");
    const doMetodo = termos.filter((t) => /equipe_metodo\(\)/.test(t));
    expect(doMetodo, "a leitura de registro_serie tem o termo do Método").toHaveLength(1);
    expect(doMetodo[0]).toMatch(/\(select equipe_metodo\(\)\)/);
    expect(metodoSemAluno("registro_serie")).toEqual([]);
  });

  it("o leitor acha o termo do Método sem o aluno do Método (a trava trava)", () => {
    const solta = [...textos, `alter policy "leitura" on public.registro_serie using ((select public.equipe_metodo()));`];
    expect(metodoSemAluno("registro_serie", solta)).toHaveLength(1);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { resumoDoErro } from "../../supabase/functions/_shared/resumoDoErro";

/**
 * O log das funções não recebe o objeto de erro nem a mensagem dele (auditoria
 * de prontidão, 06/10/2026).
 *
 * A mensagem do Auth, do PostgREST e do Asaas pode trazer dado pessoal: o
 * e-mail de quem já tem conta, o CPF que violou a restrição única
 * (`Key (cpf)=(...) already exists`), a descrição do Asaas sobre o cliente. O
 * log fica no painel do Supabase, fora do controle de acesso do produto. Até
 * esta data, 76 chamadas em 23 funções mandavam o objeto inteiro ou a mensagem; agora o log
 * leva `resumoDoErro(...)`: o nome, o código e o status, que bastam para achar
 * o defeito.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Os argumentos de cada `console.*(...)` de um código, depois do primeiro (o texto). */
function argumentosDeLog(codigo: string): { linha: number; argumento: string }[] {
  const saida: { linha: number; argumento: string }[] = [];
  const re = /console\.(error|warn|log|info|debug)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    let i = m.index + m[0].length;
    let nivel = 1;
    let aspas: string | null = null;
    let atual = "";
    const args: string[] = [];
    for (; i < codigo.length && nivel > 0; i++) {
      const c = codigo[i];
      if (aspas) {
        atual += c;
        if (c === aspas && codigo[i - 1] !== "\\") aspas = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        aspas = c;
        atual += c;
        continue;
      }
      if ("([{".includes(c)) nivel++;
      if (")]}".includes(c)) {
        nivel--;
        if (nivel === 0) break;
      }
      if (c === "," && nivel === 1) {
        args.push(atual.trim());
        atual = "";
        continue;
      }
      atual += c;
    }
    args.push(atual.trim());
    const linha = codigo.slice(0, m.index).split("\n").length;
    for (const argumento of args.slice(1)) saida.push({ linha, argumento });
  }
  return saida;
}

/** O argumento que leva o erro cru: o objeto (`error`, `e`, `xError`), a mensagem ou o objeto serializado. */
function levaErroCru(argumento: string): boolean {
  return (
    /^(e|err|error|erro|ex|falha|[a-z]+Error|[a-z]+Erro)$/.test(argumento) ||
    /\.message\b/.test(argumento) ||
    // descreverErro leva a mensagem: serve ao registro da execução (tabela
    // com acesso controlado), não ao log.
    /\bdescreverErro\(/.test(argumento) ||
    /JSON\.stringify\(\s*(e|err|error|erro|[a-z]+Error)\s*\)/.test(argumento)
  );
}

describe("log das funções sem dado pessoal", () => {
  const todos = arquivos(FUNCOES).filter((a) => !a.endsWith(`${sep}resumoDoErro.ts`));

  it("as funções foram achadas", () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it("nenhum log recebe o objeto de erro nem a mensagem dele", () => {
    const crus = todos.flatMap((a) =>
      argumentosDeLog(readFileSync(a, "utf8"))
        .filter((x) => levaErroCru(x.argumento))
        .map((x) => `${relative(FUNCOES, a).split(sep).join("/")}:${x.linha} ${x.argumento}`),
    );
    expect(crus).toEqual([]);
  });

  it("a leitura dos argumentos pega as formas que já apareceram", () => {
    const codigo = [
      'console.error("falhou", error);',
      'console.error("x", insertError);',
      'console.error("y", e instanceof Error ? e.message : String(e));',
      'console.error("z", erro.code, JSON.stringify(err));',
      'console.error("texto com error, e vírgula", resumoDoErro(error));',
      "console.warn(`modelo ${a}, b`, falha.status);",
      'console.error("w", descreverErro(e));',
    ].join("\n");
    const crus = argumentosDeLog(codigo).filter((x) => levaErroCru(x.argumento)).map((x) => x.linha);
    expect(crus).toEqual([1, 2, 3, 4, 7]);
  });
});

describe("resumoDoErro", () => {
  it("leva o nome, o código e o status, e nunca a mensagem", () => {
    const pg = { name: "PostgrestError", code: "23505", message: "Key (cpf)=(52998224725) already exists", details: "x" };
    expect(resumoDoErro(pg)).toBe("PostgrestError, código 23505");
    const auth = Object.assign(new Error("A user with email ana@exemplo.com already exists"), { code: "email_exists", status: 422 });
    expect(resumoDoErro(auth)).toBe("Error, código email_exists, status 422");
    expect(resumoDoErro(auth)).not.toMatch(/ana@/);
  });

  it("o que não é objeto vira só o tipo", () => {
    expect(resumoDoErro("CPF 52998224725 inválido")).toBe("string");
    expect(resumoDoErro(undefined)).toBe("sem detalhe");
    expect(resumoDoErro({})).toBe("erro sem código");
  });
});

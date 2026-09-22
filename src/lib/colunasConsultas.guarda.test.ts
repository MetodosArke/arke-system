import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Toda consulta `.from("tabela").select("a, b, c")` do app só pode pedir
// colunas que existem. Parece óbvio, e mesmo assim o calendário do aluno
// pediu `registro_treino.duracao_min` — coluna que não existe — durante
// meses: o PostgREST respondia erro, o código não conferia o erro, e o
// resultado era convertido à força (`as unknown as`) para o tipo esperado.
// Nenhum treino concluído aparecia no calendário, e nada acusava.
//
// Este teste lê o código-fonte e confere cada coluna simples contra
// `integrations/supabase/types.ts` (tabelas e views). Relações embutidas
// (`treinos(titulo)`) conferem só o nome da tabela.

const RAIZ = join(__dirname, "..");

function arquivosFonte(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosFonte(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Colunas por tabela/view, lidas do types.ts gerado. */
function colunasDoEsquema(): Map<string, Set<string>> {
  const tipos = readFileSync(join(RAIZ, "integrations", "supabase", "types.ts"), "utf8").replace(/\r\n/g, "\n");
  const mapa = new Map<string, Set<string>>();
  const bloco = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g;
  for (const m of tipos.matchAll(bloco)) {
    const colunas = new Set([...m[2].matchAll(/^ {10}(\w+)\??:/gm)].map((c) => c[1]));
    mapa.set(m[1], colunas);
  }
  return mapa;
}

/** Separa a lista do select por vírgula no nível de cima (fora de parênteses). */
function itensDoSelect(lista: string): string[] {
  const itens: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of lista) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      itens.push(atual.trim());
      atual = "";
    } else atual += ch;
  }
  if (atual.trim()) itens.push(atual.trim());
  return itens;
}

describe("colunas pedidas nas consultas existem no banco", () => {
  const esquema = colunasDoEsquema();

  it("o types.ts foi lido", () => {
    expect(esquema.size).toBeGreaterThan(40);
    expect(esquema.get("registro_treino")?.has("concluido")).toBe(true);
  });

  it("nenhuma consulta pede coluna ou tabela inexistente", () => {
    const problemas: string[] = [];
    for (const arquivo of arquivosFonte(RAIZ)) {
      if (arquivo.includes(join("integrations", "supabase"))) continue;
      const fonte = readFileSync(arquivo, "utf8");
      for (const m of fonte.matchAll(/\.from\(\s*"(\w+)"\s*\)/g)) {
        const tabela = m[1];
        const colunas = esquema.get(tabela);
        // storage.from("bucket") e afins não são tabelas.
        if (!colunas) continue;
        const trecho = fonte.slice(m.index!, m.index! + 600);
        // O select precisa ser o da mesma cadeia: para no próximo `.from(`.
        const ate = trecho.indexOf(".from(", 6);
        const cadeia = ate > 0 ? trecho.slice(0, ate) : trecho;
        const sel = cadeia.match(/\.select\(\s*(["'`])([\s\S]*?)\1/);
        if (!sel || sel[1] === "`" && sel[2].includes("${")) continue;
        for (const item of itensDoSelect(sel[2])) {
          if (!item || item === "*" || item.startsWith("count")) continue;
          const semAlias = item.includes(":") && !item.includes("(") ? item.split(":").pop()!.trim() : item;
          if (semAlias.includes("(")) {
            // Relação embutida: "treinos(titulo)" ou "alias:treinos!fk(col)".
            const nome = semAlias.split("(")[0].split(":").pop()!.split("!")[0].trim();
            if (!esquema.has(nome)) problemas.push(`${relative(RAIZ, arquivo)}: ${tabela} → relação ${nome}`);
            continue;
          }
          const coluna = semAlias.split("::")[0].trim();
          if (!colunas.has(coluna)) problemas.push(`${relative(RAIZ, arquivo)}: ${tabela}.${coluna}`);
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});

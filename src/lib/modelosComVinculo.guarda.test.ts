import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O item do modelo de treino guarda o vínculo com o acervo (`exercicio_id`).
 *
 * Os modelos que toda academia nova recebe nasciam sem ele: a função juntava
 * o acervo pelo nome só para copiar séries e descanso. O treino publicado leva
 * o `exercicio_id` do item para o snapshot, e o app lê os GIFs por modelo do
 * acervo por esse id; o aluno via o exercício sem GIF (09/10/2026: 93 dos 102
 * itens de modelo, e os 1.048 itens dos treinos ativos da Ponto Alto).
 *
 * Esta trava confere:
 *  - a **última** definição, nas migrations, de cada função que inclui itens
 *    de modelo: a lista de colunas leva `exercicio_id`;
 *  - a função dos modelos da academia nova busca o exercício só no acervo
 *    global e não compara o grupo antigo do roteiro com o do acervo;
 *  - no app, toda gravação que muda o nome do item grava o vínculo junto.
 */
const RAIZ = join(__dirname, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const SRC = join(RAIZ, "src");

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8").toLowerCase().replace(/\r\n/g, "\n"));

/** A última definição de cada função, pelo nome. */
function ultimasDefinicoes(): Map<string, string> {
  const re = /create or replace function public\.(\w+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/g;
  const funcoes = new Map<string, string>();
  for (const sql of migrations) for (const m of sql.matchAll(re)) funcoes.set(m[1], m[3]);
  return funcoes;
}

const INCLUI_ITEM = /insert into public\.modelo_treino_exercicios\s*\(([^)]*)\)/g;

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("o item do modelo de treino guarda o vínculo com o acervo", () => {
  const funcoes = ultimasDefinicoes();

  it("toda função que inclui item de modelo grava o exercicio_id", () => {
    const queIncluem = [...funcoes].filter(([, corpo]) => corpo.includes("insert into public.modelo_treino_exercicios"));
    // A função dos modelos da academia nova tem de estar entre elas: se o
    // nome ou o jeito de incluir mudar, a trava precisa mudar junto.
    expect(queIncluem.map(([nome]) => nome)).toContain("seed_templates_treino_padrao");
    for (const [nome, corpo] of queIncluem) {
      for (const m of corpo.matchAll(INCLUI_ITEM)) {
        expect(m[1], `${nome}: insert em modelo_treino_exercicios sem exercicio_id`).toMatch(/\bexercicio_id\b/);
      }
    }
  });

  it("os modelos da academia nova buscam o exercício só no acervo global, pelo nome", () => {
    const corpo = funcoes.get("seed_templates_treino_padrao") ?? "";
    expect(corpo).toMatch(/from public\.exercicios_biblioteca e\s+where e\.organization_id is null/);
    expect(corpo).toMatch(/having count\(\*\) = 1/);
    // O grupo do roteiro ('core', 'braços'...) não existe mais no acervo
    // desde a rodada 3: comparar os dois escondia o exercício.
    expect(corpo).not.toMatch(/eb\.grupo_muscular = v\.grupo_muscular/);
  });

  it("no app, quem muda o nome do item grava o vínculo junto", () => {
    const semVinculo: string[] = [];
    let gravacoes = 0;
    for (const arquivo of arquivos(SRC)) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(/\.from\("modelo_treino_exercicios"\)/g)) {
        // A instrução inteira: do `.from(...)` até o fim da chamada encadeada.
        const fim = texto.indexOf(";", m.index);
        const instrucao = texto.slice(m.index, fim === -1 ? undefined : fim);
        if (!/\.(insert|update|upsert)\(/.test(instrucao) || !/\bnome_exercicio\b/.test(instrucao)) continue;
        gravacoes++;
        if (!/\bexercicio_id\b/.test(instrucao)) semVinculo.push(relative(RAIZ, arquivo));
      }
    }
    expect(gravacoes, "a varredura achou as gravações do item").toBeGreaterThanOrEqual(2);
    expect(semVinculo).toEqual([]);
  });
});

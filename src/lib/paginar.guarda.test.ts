import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TAMANHO_PAGINA } from "./paginar";

/**
 * Trava de `paginar.ts`: a API do banco para em mil linhas sem avisar, e uma
 * lista longa de ids no `.in()` não cabe no endereço da consulta (800 ids já
 * voltam 400). As duas coisas só aparecem numa academia grande, depois do
 * lançamento — então quem garante é este teste, não a revisão.
 *
 * Regra 1: ler uma tabela que cresce com a academia filtrando só pela
 * academia (`organization_id`) exige `.range()` — isto é, passar por
 * `todasAsLinhas` — ou um limite explícito, de até mil (regra 3).
 * Regra 2: `.in("id"|"user_id"|"aluno_id"|..., lista)` exige `porLotes` (a
 * lista chega como `lote`), a menos que a lista seja curta por natureza e
 * esteja em LISTAS_CURTAS com o porquê.
 * Regra 3: nenhum `.limit(N)` passa de mil, no app e nas edge functions: acima
 * disso a API devolve mil, com status 200.
 */
const SRC = join(__dirname, "..");

const TABELAS_QUE_CRESCEM = [
  "alunos",
  "profiles",
  "registro_treino",
  "presencas",
  "checkins",
  "mensalidades",
  "pagamentos",
  "cobrancas_avulsas",
  "lancamentos_financeiros",
  "tarefas",
  "aluno_assinaturas",
  "aluno_matriculas_academia",
  "dietas",
  "treinos",
  "notas_fiscais",
  "acessos_catraca_logs",
  "agendamentos",
];

// Consulta feita por lote (`.in(..., lote)`, dentro de `porLotes`) já é limitada ao lote.
const LIMITADORES = /\.(range|limit|single|maybeSingle)\(|head:\s*true|\.eq\(\s*"(id|aluno_id|user_id|data)"|\.in\(\s*"\w+",\s*lote\s*\)/;

/** Buscas por lista de ids que são curtas por natureza, com o porquê. */
const LISTAS_CURTAS: Record<string, string> = {
  "pages/admin/AdminAgenda.tsx": "perfis da equipe (professores e nutricionistas)",
  "pages/admin/AdminEquipe.tsx": "perfis da equipe",
  "pages/admin/AdminFinanceiro.tsx": "perfis da equipe na folha e nas comissões",
  "components/admin/NotasFiscaisPainel.tsx": "alunos das 50 notas mais recentes",
  "components/chat/ChatMentor.tsx": "mensagens abertas de uma conversa",
};

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** Cada `.from("tabela")` com a cadeia até o fim da instrução. */
export function consultas(codigo: string) {
  const achadas: { tabela: string; cadeia: string; linha: number }[] = [];
  const re = /\.from\("([a-z_]+)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo))) {
    const resto = codigo.slice(m.index, m.index + 800);
    const fim = resto.search(/;\s*\n|\n\s*\n/);
    achadas.push({ tabela: m[1], cadeia: fim > 0 ? resto.slice(0, fim) : resto, linha: codigo.slice(0, m.index).split("\n").length });
  }
  return achadas;
}

/** Listas de ids no `.in()` que não vêm de um lote. */
export function inSemLote(codigo: string) {
  return [...codigo.matchAll(/\.in\(\s*"(id|user_id|aluno_id|modelo_id)",\s*([A-Za-z_]\w*)\s*\)/g)]
    .filter((m) => m[2] !== "lote")
    .map((m) => ({ coluna: m[1], lista: m[2], linha: codigo.slice(0, m.index).split("\n").length }));
}

/**
 * `.limit(N)` com N acima do teto da API: o número escrito ou uma constante
 * `const NOME = N` do mesmo arquivo. Limite que vem de estado (a página do
 * feed que cresce) não dá para saber aqui.
 */
export function limitesAcimaDoTeto(codigo: string) {
  const constantes = new Map(
    [...codigo.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*=\s*([\d_]+)\s*;/g)].map((m) => [m[1], Number(m[2].replace(/_/g, ""))]),
  );
  return [...codigo.matchAll(/\.limit\(\s*([\d_]+|[A-Za-z_]\w*)\s*\)/g)]
    .map((m) => ({ valor: /^[\d_]+$/.test(m[1]) ? Number(m[1].replace(/_/g, "")) : constantes.get(m[1]), linha: codigo.slice(0, m.index).split("\n").length }))
    .filter((l): l is { valor: number; linha: number } => typeof l.valor === "number" && l.valor > TAMANHO_PAGINA);
}

/**
 * Limite que vem de estado da tela: `.limit(x)` ou `.range(0, x)` com `x`
 * tirado de um `useState` (ou de uma conta com ele). É o "Ver mais" que soma
 * ao limite: cresce sem teto, passa de mil e a API corta sem avisar. O feed
 * fazia isso até 06/10/2026. A saída é paginar de verdade, por cursor (a
 * página seguinte começa depois do último item) ou por uma janela de tamanho
 * fixo (`.range(pagina * N, pagina * N + N - 1)`).
 */
export function limitesQueCrescem(codigo: string) {
  const estados = new Set([...codigo.matchAll(/const\s*\[\s*(\w+)\s*,\s*set\w*\s*\]\s*=\s*(?:React\.)?useState\b/g)].map((m) => m[1]));
  const usaEstado = (expr: string) => (expr.match(/[A-Za-z_$][\w$]*/g) ?? []).some((nome) => estados.has(nome));
  const achados: { linha: number; trecho: string }[] = [];
  for (const m of codigo.matchAll(/\.limit\(\s*([^)]*?)\s*\)|\.range\(\s*0\s*,\s*([^)]*?)\s*\)/g)) {
    const expr = m[1] ?? m[2] ?? "";
    if (usaEstado(expr)) achados.push({ linha: codigo.slice(0, m.index).split("\n").length, trecho: m[0] });
  }
  return achados;
}

const codigos = arquivos(SRC).map((caminho) => ({
  nome: relative(SRC, caminho).replace(/\\/g, "/"),
  codigo: readFileSync(caminho, "utf8"),
}));

const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");
const codigosFuncoes = arquivos(FUNCOES).map((caminho) => ({
  nome: `supabase/functions/${relative(FUNCOES, caminho).replace(/\\/g, "/")}`,
  codigo: readFileSync(caminho, "utf8"),
}));

describe("leituras que passam de mil linhas", () => {
  it("o detector detecta (senão os testes abaixo passariam sem verificar nada)", () => {
    const sem = consultas('const { data } = await supabase.from("alunos").select("id").eq("organization_id", org);\n');
    expect(sem.some((c) => !LIMITADORES.test(c.cadeia))).toBe(true);
    const com = consultas('todasAsLinhas((de, ate) => supabase.from("alunos").select("id").eq("organization_id", org).order("id").range(de, ate));\n');
    expect(com.every((c) => LIMITADORES.test(c.cadeia))).toBe(true);
    expect(inSemLote('supabase.from("profiles").select("*").in("user_id", userIds)')).toHaveLength(1);
    expect(inSemLote('porLotes(ids, (lote) => supabase.from("profiles").select("*").in("user_id", lote))')).toHaveLength(0);
  });

  it("a academia inteira é lida em páginas", () => {
    const violacoes = codigos.flatMap(({ nome, codigo }) =>
      consultas(codigo)
        .filter((c) => TABELAS_QUE_CRESCEM.includes(c.tabela))
        .filter((c) => /\.eq\(\s*"organization_id"/.test(c.cadeia) && !/\.(update|delete|insert|upsert)\(/.test(c.cadeia))
        .filter((c) => !LIMITADORES.test(c.cadeia))
        .map((c) => `${nome}:${c.linha} (${c.tabela})`),
    );
    expect(violacoes, "use todasAsLinhas() de @/lib/paginar").toEqual([]);
  });

  it("lista de ids vai em lotes, salvo as curtas por natureza", () => {
    const violacoes = codigos.flatMap(({ nome, codigo }) =>
      LISTAS_CURTAS[nome] ? [] : inSemLote(codigo).map((i) => `${nome}:${i.linha} (.in("${i.coluna}", ${i.lista}))`),
    );
    expect(violacoes, "use porLotes() de @/lib/paginar").toEqual([]);
  });

  it("nenhum limite passa do teto de mil linhas", () => {
    // Brecha fechada em 06/10/2026: a regra 1 aceitava qualquer `.limit(`, e
    // a conferência dos parceiros pedia `.limit(2000)` — a API devolvia mil, com
    // status 200, e o repasse do mês era conferido contra um número cortado.
    // Vale também para as edge functions: o teto é do PostgREST, com qualquer chave.
    expect(limitesAcimaDoTeto('supabase.from("x").select("id").limit(2000);'), "o detector detecta").toHaveLength(1);
    expect(limitesAcimaDoTeto('const LOTE = 5_000;\nsupabase.from("x").select("id").limit(LOTE);'), "e resolve a constante do arquivo").toHaveLength(1);
    expect(limitesAcimaDoTeto('supabase.from("x").select("id").limit(1000);')).toHaveLength(0);
    const violacoes = [...codigos, ...codigosFuncoes].flatMap(({ nome, codigo }) =>
      limitesAcimaDoTeto(codigo).map((l) => `${nome}:${l.linha} (.limit(${l.valor}))`),
    );
    expect(violacoes, `acima de ${TAMANHO_PAGINA} a API corta sem avisar: use todasAsLinhas() de @/lib/paginar`).toEqual([]);
  });

  it("nenhum limite cresce com a tela (o \"Ver mais\" que soma ao limite)", () => {
    const feedAntigo = `const [limite, setLimite] = useState(PAGE_SIZE);
      const { data } = useQuery({ queryFn: () => supabase.from("feed_posts").select("*").order("created_at").limit(limite) });
      <Button onClick={() => setLimite((l) => l + PAGE_SIZE)}>Carregar mais</Button>`;
    expect(limitesQueCrescem(feedAntigo), "o detector detecta o feed de antes").toHaveLength(1);
    expect(limitesQueCrescem("const [n, setN] = useState(20);\nsupabase.from(\"x\").select(\"id\").range(0, n * 2 - 1);"), "e a faixa que cresce").toHaveLength(1);
    expect(limitesQueCrescem("const [pagina, setPagina] = useState(0);\nsupabase.from(\"x\").select(\"id\").range(pagina * 20, pagina * 20 + 19);"), "a janela fixa passa").toHaveLength(0);
    expect(limitesQueCrescem("const PAGE_SIZE = 15;\nsupabase.from(\"x\").select(\"id\").limit(PAGE_SIZE);"), "a constante passa").toHaveLength(0);
    const violacoes = codigos.flatMap(({ nome, codigo }) => limitesQueCrescem(codigo).map((l) => `${nome}:${l.linha} ${l.trecho}`));
    expect(violacoes, "pagine por cursor ou por janela fixa (veja src/lib/cursorFeed.ts)").toEqual([]);
  });

  it("toda exceção listada ainda existe", () => {
    // Exceção de arquivo que mudou vira passe livre para uma lista que cresceu.
    for (const nome of Object.keys(LISTAS_CURTAS)) {
      const arquivo = codigos.find((c) => c.nome === nome);
      expect(arquivo && inSemLote(arquivo.codigo).length > 0, nome).toBe(true);
    }
  });
});

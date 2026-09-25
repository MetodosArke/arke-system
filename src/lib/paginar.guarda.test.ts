import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava de `paginar.ts`: a API do banco para em mil linhas sem avisar, e uma
 * lista longa de ids no `.in()` não cabe no endereço da consulta (800 ids já
 * voltam 400). As duas coisas só aparecem numa academia grande, depois do
 * lançamento — então quem garante é este teste, não a revisão.
 *
 * Regra 1: ler uma tabela que cresce com a academia filtrando só pela
 * academia (`organization_id`) exige `.range()` — isto é, passar por
 * `todasAsLinhas` — ou um limite explícito.
 * Regra 2: `.in("id"|"user_id"|"aluno_id"|..., lista)` exige `porLotes` (a
 * lista chega como `lote`), a menos que a lista seja curta por natureza e
 * esteja em LISTAS_CURTAS com o porquê.
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

const codigos = arquivos(SRC).map((caminho) => ({
  nome: relative(SRC, caminho).replace(/\\/g, "/"),
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

  it("toda exceção listada ainda existe", () => {
    // Exceção de arquivo que mudou vira passe livre para uma lista que cresceu.
    for (const nome of Object.keys(LISTAS_CURTAS)) {
      const arquivo = codigos.find((c) => c.nome === nome);
      expect(arquivo && inSemLote(arquivo.codigo).length > 0, nome).toBe(true);
    }
  });
});

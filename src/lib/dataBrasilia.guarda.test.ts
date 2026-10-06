import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Trava estrutural contra o defeito de fuso corrigido em 23/09/2026.
 *
 * `new Date().toISOString().slice(0, 10)` é o jeito mais natural de escrever
 * "a data de hoje em YYYY-MM-DD" e está errado: `toISOString()` converte para
 * UTC, então das 21h à meia-noite de Brasília ele devolve o dia seguinte.
 * Havia 12 ocorrências no app. Como o banco também estava em UTC, os dois
 * erravam juntos e nada aparecia; com o banco em `America/Sao_Paulo`, eles
 * passariam a discordar três horas por noite — o aluno registra o treino, o
 * banco grava hoje, e a tela pergunta por amanhã.
 *
 * `getTimezoneOffset()` é o quase-certo, e por isso mais perigoso: dá a data
 * **do aparelho**. Funciona para quem está no Brasil com o relógio certo, e
 * falha para o aluno viajando ou com o fuso trocado — que veria uma semana de
 * treinos diferente da que a academia e o banco veem.
 *
 * É o mesmo tipo de armadilha do vínculo duplo: parece certo, e por isso
 * volta a cada tela nova. Em vez de confiar em lembrar, este teste lê o código.
 */

const RAIZ = join(__dirname, "..", "..");

/**
 * As edge functions entram na varredura porque o defeito estava lá também —
 * `asaas-webhook` gravava `data_pagamento` em UTC, e no último dia do mês o
 * pagamento das 22h caía no mês seguinte do fechamento contábil. Elas não
 * importam do bundle do app, então têm o módulo espelho em `_shared/data.ts`.
 */
const RAIZES = ["src", join("supabase", "functions")];

/** Os próprios módulos de data são onde a conversão pode aparecer. */
const PERMITIDOS = new Set([
  "src/lib/dataBrasilia.ts",
  "src/lib/dataBrasilia.test.ts",
  "src/lib/dataBrasilia.guarda.test.ts",
  "supabase/functions/_shared/data.ts",
]);

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

const fontes = RAIZES.flatMap((raiz) => arquivos(join(RAIZ, raiz))).map((caminho) => ({
  nome: caminho.slice(RAIZ.length + 1).replace(/\\/g, "/"),
  codigo: readFileSync(caminho, "utf8"),
}));

/**
 * As colunas `date` do banco, pelas migrations e pelo retrato fiel de como o
 * banco foi construído. Um nome que é `date` numa tabela e `timestamptz` em
 * outra fica de fora: aí a leitura com `new Date()` pode estar certa.
 */
function colunasDeData(): Set<string> {
  const datas = new Set<string>();
  const horas = new Set<string>();
  for (const pasta of ["historico", "migrations"]) {
    const dir = join(RAIZ, "supabase", pasta);
    for (const arquivo of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, arquivo), "utf8").toLowerCase();
      const marcar = (nome: string, tipo: string) => (tipo === "date" ? datas : horas).add(nome);
      for (const t of sql.matchAll(/create table (?:if not exists )?(?:public\.)?\w+\s*\(([\s\S]*?)\n\s*\);/g)) {
        for (const c of t[1].matchAll(/^\s*"?(\w+)"?\s+(date|timestamptz|timestamp)\b/gm)) marcar(c[1], c[2]);
      }
      for (const c of sql.matchAll(/add column (?:if not exists )?"?(\w+)"?\s+(date|timestamptz|timestamp)\b/g)) marcar(c[1], c[2]);
      for (const c of sql.matchAll(/alter column "?(\w+)"? (?:set data )?type (date|timestamptz|timestamp)\b/g)) marcar(c[1], c[2]);
    }
  }
  return new Set([...datas].filter((c) => !horas.has(c)));
}

const COLUNAS_DE_DATA = colunasDeData();

/** `new Date(x.coluna)` (ou `x?.coluna`, `x!.coluna`) com uma coluna `date`. */
function leiturasDeDataPura(codigo: string) {
  return [...codigo.matchAll(/new Date\(\s*[\w$]+(?:[?!]?\.[\w$]+)*[?!]?\.(\w+)\s*\)/g)]
    .filter((m) => COLUNAS_DE_DATA.has(m[1]))
    .map((m) => ({ trecho: m[0], linha: codigo.slice(0, m.index).split("\n").length }));
}

describe("a data do negócio é a de Brasília", () => {
  it("encontra os fontes", () => {
    expect(fontes.length).toBeGreaterThan(50);
  });

  it("ninguém fatia toISOString() para obter uma data", () => {
    const culpados = fontes
      .filter((f) => !PERMITIDOS.has(f.nome))
      .filter((f) => /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(f.codigo))
      .map((f) => f.nome);

    expect(culpados, 'toISOString() converte para UTC: das 21h à meia-noite de Brasília devolve o dia seguinte, e a tela passa a discordar do banco. Use hojeBrasilia()/dataBrasilia() de "@/lib/dataBrasilia".').toEqual([]);
  });

  it("ninguém monta data a partir do fuso do aparelho", () => {
    const culpados = fontes
      .filter((f) => !PERMITIDOS.has(f.nome))
      .filter((f) => /getTimezoneOffset\(\)/.test(f.codigo))
      .map((f) => f.nome);

    expect(culpados, "getTimezoneOffset() dá a data do aparelho, não a da academia: falha para quem está viajando ou com o fuso trocado. Use dataBrasilia().").toEqual([]);
  });

  it("ninguém mostra data pura com new Date(...).toLocaleDateString", () => {
    // `new Date("2026-07-01")` é meia-noite em UTC: em Brasília, o dia
    // anterior. Eram cerca de trinta telas mostrando a data um dia antes.
    const culpados = fontes
      .filter((f) => !PERMITIDOS.has(f.nome) && !f.nome.includes(".test."))
      // Quem fixa o fuso de Brasília nas opções está certo (as edge functions
      // não importam do app e fazem assim).
      .filter((f) => (f.codigo.match(/new Date\([^()`,]+\)\.toLocaleDateString\([^)]*\)/g) ?? []).some((c) => !c.includes("America/Sao_Paulo")))
      .map((f) => f.nome);

    expect(culpados, 'Data pura lida como UTC aparece um dia antes em Brasília. Use formatarDataBR() de "@/lib/dataBrasilia".').toEqual([]);
  });

  it("ninguém lê coluna de data pura com new Date(...)", () => {
    // Brecha fechada em 06/10/2026: a regra acima só pegava a data pura
    // levada à tela com toLocaleDateString. Comparada, ela errava do mesmo
    // jeito e sem aparecer: `new Date(d.data_fim) >= new Date()` dava o desafio
    // como encerrado desde as 21h da véspera, e `new Date(a.data)` tirava o
    // domingo do resumo da semana da dieta. As colunas `date` vêm do próprio
    // banco (migrations), então coluna nova entra sozinha.
    expect(COLUNAS_DE_DATA.size, "as colunas de data foram achadas").toBeGreaterThan(15);
    expect(COLUNAS_DE_DATA.has("data_fim") && COLUNAS_DE_DATA.has("data")).toBe(true);
    expect(COLUNAS_DE_DATA.has("created_at"), "timestamp não é data pura").toBe(false);
    expect(leiturasDeDataPura("const ativo = new Date(d.data_fim) >= new Date();"), "o detector detecta").toHaveLength(1);
    expect(leiturasDeDataPura("const d = new Date(a?.data);")).toHaveLength(1);
    expect(leiturasDeDataPura("new Date(`${d.data_fim}T12:00:00-03:00`)")).toHaveLength(0);
    expect(leiturasDeDataPura("new Date(m.created_at)")).toHaveLength(0);

    const culpados = fontes
      .filter((f) => !PERMITIDOS.has(f.nome) && !f.nome.includes(".test."))
      .flatMap((f) => leiturasDeDataPura(f.codigo).map((l) => `${f.nome}:${l.linha} (${l.trecho})`));

    expect(culpados, 'Coluna `date` lida com new Date() é meia-noite em UTC: 21h da véspera em Brasília. Compare o texto com hojeBrasilia()/semanaBrasilia(), ou leia ao meio-dia (`${data}T12:00:00-03:00`).').toEqual([]);
  });

  it("ninguém desconta três horas na mão", () => {
    const culpados = fontes
      .filter((f) => !PERMITIDOS.has(f.nome))
      // O deslocamento escrito à mão acerta o valor e erra o motivo: some no
      // horário de verão e não diz a ninguém por que existe.
      // As três grafias que já apareceram: `3 * 3600_000` no app,
      // `3 * 60 * 60 * 1000` na edge function, e o valor pronto.
      .filter((f) => /3\s*\*\s*3600_?000|3\s*\*\s*60\s*\*\s*60\s*\*\s*1000|10_?800_?000/.test(f.codigo))
      .map((f) => f.nome);

    expect(culpados, "Deslocamento de fuso escrito à mão. Use dataBrasilia().").toEqual([]);
  });
});

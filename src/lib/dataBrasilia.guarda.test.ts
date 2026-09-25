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

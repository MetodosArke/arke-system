/**
 * Exportação para Excel (.xlsx) no navegador, com uma aba por assunto. A
 * biblioteca é carregada só na hora de exportar — não pesa no app.
 */

export type Celula = string | number | null;
export type Aba = { nome: string; linhas: Celula[][] };

/** Primeiro e último dia de um mês "AAAA-MM", para filtrar datas. */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimoDia).padStart(2, "0")}` };
}

/** Data ISO para dd/mm/aaaa, sem deslocar o dia pelo fuso. */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function baixar(conteudo: Blob, nomeArquivo: string) {
  const url = URL.createObjectURL(conteudo);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function baixarPlanilha(nomeArquivo: string, abas: Aba[]) {
  const { utils, write } = await import("xlsx");
  const livro = utils.book_new();
  for (const aba of abas) {
    // Nome de aba no Excel: até 31 caracteres, sem : \ / ? * [ ]
    utils.book_append_sheet(livro, utils.aoa_to_sheet(aba.linhas), aba.nome.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  }
  const buffer = write(livro, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  baixar(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    nomeArquivo.endsWith(".xlsx") ? nomeArquivo : `${nomeArquivo}.xlsx`,
  );
}

/**
 * Texto que o Excel leria como fórmula (começa com =, +, -, @) vai com um
 * apóstrofo na frente: o nome de uma academia ou um e-mail não roda nada no
 * computador de quem abre. Número negativo e valor em reais ficam como estão.
 */
const FORMULA = /^(?:[=+@\t\r]|-(?!\s*(?:R\$\s*)?[\d.,]+%?$))/;

/** CSV com ponto e vírgula (o Excel em português), cada célula entre aspas. */
export function textoCsv(linhas: Celula[][]): string {
  return linhas
    .map((linha) =>
      linha
        .map((valor) => {
          const texto = valor === null ? "" : String(valor);
          const seguro = typeof valor === "string" && FORMULA.test(texto) ? `'${texto}` : texto;
          return `"${seguro.replace(/"/g, '""')}"`;
        })
        .join(";"),
    )
    .join("\n");
}

export function baixarCsv(nomeArquivo: string, linhas: Celula[][]) {
  // O BOM faz o Excel ler os acentos como UTF-8.
  baixar(new Blob(["﻿" + textoCsv(linhas)], { type: "text/csv;charset=utf-8;" }), nomeArquivo);
}

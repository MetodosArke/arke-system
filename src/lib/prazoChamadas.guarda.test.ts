import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toda chamada de uma edge function a outro serviço tem prazo
 * (`AbortSignal.timeout`). Sem prazo, um Asaas lento segura a função até o
 * limite da plataforma: a recepção fica olhando um botão girando, e na
 * conferência diária uma chamada presa segura a rodada inteira. Até
 * 05/10/2026, 17 chamadas (Asaas, Resend e a do próprio webhook) não tinham.
 */
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : nome.endsWith(".ts") ? [caminho] : [];
  });
}

/** O texto de cada `fetch(...)`, com os parênteses equilibrados. */
function chamadas(codigo: string): string[] {
  const achadas: string[] = [];
  let pos = 0;
  for (;;) {
    const k = codigo.indexOf("fetch(", pos);
    if (k < 0) return achadas;
    const antes = codigo[k - 1] ?? " ";
    pos = k + 6;
    if (/[\w.]/.test(antes)) continue;
    let nivel = 1;
    let i = pos;
    while (i < codigo.length && nivel > 0) {
      if (codigo[i] === "(") nivel++;
      else if (codigo[i] === ")") nivel--;
      i++;
    }
    achadas.push(codigo.slice(k, i));
  }
}

describe("chamadas das edge functions com prazo", () => {
  const todas = arquivos(FUNCOES).flatMap((arquivo) =>
    chamadas(readFileSync(arquivo, "utf8")).map((texto) => ({ arquivo: relative(FUNCOES, arquivo).replace(/\\/g, "/"), texto }))
  );

  it("as chamadas foram achadas", () => {
    expect(todas.length).toBeGreaterThan(20);
  });

  // Prazo por AbortSignal.timeout, ou por um AbortController com o próprio
  // tempo (a consulta de senha vazada da matrícula pública).
  it("todo fetch leva um signal com prazo", () => {
    const sem = todas.filter((c) => !/signal:\s*(AbortSignal\.timeout\(|\w+\.signal)/.test(c.texto)).map((c) => `${c.arquivo}: ${c.texto.slice(0, 80)}`);
    expect(sem).toEqual([]);
  });
});

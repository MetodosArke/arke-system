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

  // Frente D, 07/10/2026: o e-mail do login (`send-email`) ia pelo SDK do
  // Resend, que não aceita prazo e escapava da regra acima, porque não há
  // `fetch(` no código de quem chama. Todo envio ao Resend vai pela API.
  it("todo envio ao Resend é um fetch com prazo, e nenhuma função usa o SDK dele", () => {
    const resend = todas.filter((c) => /api\.resend\.com/.test(c.texto));
    expect(resend.length).toBeGreaterThanOrEqual(17);
    expect(resend.map((c) => c.arquivo)).toContain("send-email/index.ts");
    expect(resend.filter((c) => !/signal:\s*AbortSignal\.timeout\(/.test(c.texto)).map((c) => c.arquivo)).toEqual([]);
    const sdk = arquivos(FUNCOES)
      .filter((arquivo) => /from\s+["']npm:resend\b|\bnew Resend\(/.test(readFileSync(arquivo, "utf8")))
      .map((arquivo) => relative(FUNCOES, arquivo).replace(/\\/g, "/"));
    expect(sdk).toEqual([]);
  });
});

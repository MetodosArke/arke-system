import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Todo e-mail que sai pelo Resend leva `Idempotency-Key` (13/10/2026). Sem a
 * chave, uma repetição — o cliente que tenta de novo, a rotina do pg_cron que
 * roda de novo, o Auth que repete o pedido — entregava o mesmo e-mail duas
 * vezes. Até aqui, 13 das 19 chamadas ao Resend saíam sem chave. A chave se
 * monta por `chaveDeIdempotencia()` (`_shared/idempotenciaEmail.ts`), que
 * recusa e-mail e nome: só ids, datas e resumos.
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

describe("e-mail pelo Resend com chave de idempotência", () => {
  const envios = arquivos(FUNCOES).flatMap((arquivo) =>
    chamadas(readFileSync(arquivo, "utf8"))
      .filter((texto) => /api\.resend\.com\/emails/.test(texto))
      .map((texto) => ({ arquivo: relative(FUNCOES, arquivo).replace(/\\/g, "/"), texto })),
  );

  it("os envios foram achados", () => {
    expect(envios.length).toBeGreaterThanOrEqual(19);
    expect(envios.map((e) => e.arquivo)).toContain("send-email/index.ts");
  });

  it("todo envio leva Idempotency-Key, direto ou por cabecalhosDoResend", () => {
    const sem = envios
      .filter((e) => !/["']Idempotency-Key["']:|cabecalhosDoResend\(/.test(e.texto))
      .map((e) => `${e.arquivo}: ${e.texto.slice(0, 60)}`);
    expect(sem).toEqual([]);
  });

  it("nenhuma chave é montada com o endereço de alguém", () => {
    const comEmail = envios
      .filter((e) => /Idempotency-Key[^\n]*\b(email|emails|para|to)\b|cabecalhosDoResend\([^)]*\b(email|emails|para|to)\b/i.test(e.texto))
      .map((e) => e.arquivo);
    expect(comEmail).toEqual([]);
  });
});

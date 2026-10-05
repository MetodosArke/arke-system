import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deveRelatar, eventoDeErro } from "../../supabase/functions/_shared/erroServidor";

/**
 * Toda edge function entra pelo `servir` (supabase/functions/_shared/servir.ts),
 * com o nome da própria pasta: é ele que manda o erro 500 ao Sentry e devolve
 * JSON em vez da página de erro do runtime. Uma função nova com `Deno.serve`
 * falharia em silêncio para nós.
 */
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

describe("toda edge function entra pelo servir", () => {
  const pastas = readdirSync(FUNCOES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(FUNCOES, d.name, "index.ts")))
    .map((d) => d.name);

  it("as funções foram encontradas", () => {
    expect(pastas.length).toBeGreaterThan(40);
  });

  it("cada index.ts chama servir com o nome da pasta, e nenhuma usa Deno.serve", () => {
    const erradas = pastas.filter((nome) => {
      const fonte = readFileSync(join(FUNCOES, nome, "index.ts"), "utf8");
      return fonte.includes("Deno.serve(") || (fonte.match(/\bservir\(\s*"([^"]+)"/g) ?? []).join() !== `servir("${nome}"`;
    });
    expect(erradas).toEqual([]);
  });
});

describe("o que vai ao Sentry", () => {
  it("500, 502 e 504 vão; 503 (desligado de propósito) e 4xx não", () => {
    expect([500, 502, 504].map(deveRelatar)).toEqual([true, true, true]);
    expect([503, 400, 401, 404, 429].map(deveRelatar)).toEqual([false, false, false, false, false]);
  });

  it("leva a função, o status, o tipo e o código, e nunca a mensagem do erro", () => {
    const erro = Object.assign(new Error('duplicate key value violates unique constraint: Key (cpf)=(12345678901) already exists'), {
      code: "23505",
    });
    const evento = eventoDeErro("convidar-membro", 500, erro);
    const texto = JSON.stringify(evento);
    expect(evento.tags).toMatchObject({ funcao: "convidar-membro", status: "500", codigo: "23505" });
    expect(evento.exception.values[0]).toMatchObject({ type: "Error", value: "convidar-membro: Error 23505" });
    expect(texto).not.toContain("12345678901");
    expect(texto).not.toContain("duplicate key");
  });

  it("sem erro (a função respondeu 502 sozinha), o evento diz só isso", () => {
    const evento = eventoDeErro("asaas-reconciliar", 502);
    expect(evento.message.formatted).toBe("asaas-reconciliar respondeu 502");
    expect(evento.exception.values[0].type).toBe("RespostaDeErro");
  });

  it("código fora do formato não vai", () => {
    const evento = eventoDeErro("x", 500, Object.assign(new Error("e"), { code: "valor com espaço e dado" }));
    expect(evento.tags).not.toHaveProperty("codigo");
  });
});

import { describe, it, expect } from "vitest";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { mensagemDeErroEdge } from "./erroEdge";

function respostaHttp(status: number, corpo: string, tipo = "application/json") {
  return new FunctionsHttpError(new Response(corpo, { status, headers: { "Content-Type": tipo } }));
}

describe("mensagemDeErroEdge", () => {
  it("devolve o texto que a função escreveu, não a frase genérica do cliente", async () => {
    // O caso que motivou o helper: sem ele, o aluno lia "Edge Function
    // returned a non-2xx status code" no lugar desta mensagem.
    const erro = respostaHttp(400, JSON.stringify({ error: "Esta senha já apareceu 3 vezes em vazamentos." }));
    expect(await mensagemDeErroEdge(erro, "padrão")).toBe("Esta senha já apareceu 3 vezes em vazamentos.");
  });

  it("serve para qualquer status — 409, 429, 403", async () => {
    for (const status of [403, 409, 429]) {
      const erro = respostaHttp(status, JSON.stringify({ error: `mensagem ${status}` }));
      expect(await mensagemDeErroEdge(erro, "padrão")).toBe(`mensagem ${status}`);
    }
  });

  it("aceita `message` quando a função usa esse nome", async () => {
    const erro = respostaHttp(500, JSON.stringify({ message: "falhou lá dentro" }));
    expect(await mensagemDeErroEdge(erro, "padrão")).toBe("falhou lá dentro");
  });

  it("cai no padrão quando o corpo não é JSON", async () => {
    const erro = respostaHttp(502, "<html>Bad Gateway</html>", "text/html");
    expect(await mensagemDeErroEdge(erro, "Falha ao matricular.")).toBe("Falha ao matricular.");
  });

  it("cai no padrão quando o JSON não traz texto", async () => {
    const erro = respostaHttp(500, JSON.stringify({ ok: false }));
    expect(await mensagemDeErroEdge(erro, "Falha ao matricular.")).toBe("Falha ao matricular.");
  });

  it("não consome o corpo de quem chamou", async () => {
    const erro = respostaHttp(400, JSON.stringify({ error: "x" }));
    await mensagemDeErroEdge(erro, "padrão");
    // Ainda dá para ler: o helper leu de um clone.
    await expect((erro.context as Response).json()).resolves.toEqual({ error: "x" });
  });

  it("diferencia falta de rede de erro da função", async () => {
    const erro = new FunctionsFetchError(new TypeError("Failed to fetch"));
    expect(await mensagemDeErroEdge(erro, "padrão")).toMatch(/internet/);
  });

  it("repassa a mensagem de um Error comum", async () => {
    expect(await mensagemDeErroEdge(new Error("As senhas não coincidem."), "padrão")).toBe("As senhas não coincidem.");
  });
});

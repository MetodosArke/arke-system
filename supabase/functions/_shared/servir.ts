import { deveRelatar } from "./erroServidor.ts";
import { relatarErro } from "./sentry.ts";

// O ponto de entrada de toda edge function, no lugar do `Deno.serve`.
//
// Faz duas coisas que nenhuma função fazia sozinha:
//   * erro não tratado vira 500 com corpo JSON, em vez da página de erro do
//     runtime, e vai para o Sentry;
//   * resposta 500, 502 ou 504 que a própria função devolveu também vai para
//     o Sentry. O 503 fica de fora: é a resposta de propósito de recurso
//     desligado ou fornecedor indisponível ("Sentinela desligado").
//
// O nome passado é o da pasta da função; `servir.guarda.test.ts` confere.

declare const EdgeRuntime: { waitUntil(promessa: Promise<unknown>): void } | undefined;

/** Deixa o envio terminar depois da resposta, quando o runtime permite. */
function emSegundoPlano(promessa: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(promessa);
  else void promessa;
}

export function servir(nome: string, tratar: (req: Request) => Response | Promise<Response>): void {
  Deno.serve(async (req: Request) => {
    try {
      const resposta = await tratar(req);
      if (deveRelatar(resposta.status)) emSegundoPlano(relatarErro(nome, resposta.status));
      return resposta;
    } catch (erro) {
      // Só o tipo vai para o log: a mensagem pode trazer dado.
      console.error(`${nome}: erro não tratado`, erro instanceof Error ? erro.name : typeof erro);
      emSegundoPlano(relatarErro(nome, 500, erro));
      return new Response(JSON.stringify({ error: "Erro interno. Tente de novo em instantes." }), {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      });
    }
  });
}

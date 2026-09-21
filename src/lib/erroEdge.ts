/**
 * Mensagem legível de um erro vindo de `supabase.functions.invoke`.
 *
 * Quando a edge function responde com status não-2xx, o cliente do Supabase
 * devolve `data: null` e um `FunctionsHttpError` cuja mensagem é sempre a
 * mesma: "Edge Function returned a non-2xx status code". O texto que a função
 * escreveu — "Já existe uma conta com esse e-mail", "CPF inválido", "Esta
 * senha já apareceu em vazamentos" — fica no **corpo** da resposta, em
 * `error.context`, e ninguém lia.
 *
 * O padrão do app era `data?.error ?? error.message`, que parece cobrir o
 * caso mas não cobre: nas respostas de erro, `data` é justamente o que vem
 * nulo. Toda validação feita no servidor chegava ao usuário como a frase em
 * inglês acima.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

const SEM_CONEXAO = "Não foi possível falar com o servidor. Verifique a internet e tente de novo.";

export async function mensagemDeErroEdge(error: unknown, padrao: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const resposta = error.context as Response | undefined;
    if (resposta) {
      try {
        // clone(): o corpo só pode ser lido uma vez, e quem chamou pode
        // querer lê-lo também.
        const corpo = await resposta.clone().json();
        const texto = corpo?.error ?? corpo?.message;
        if (typeof texto === "string" && texto.trim()) return texto;
      } catch {
        // Corpo que não é JSON (gateway, página HTML de erro): cai no padrão.
      }
    }
    return padrao;
  }

  // Requisição que nem chegou à função: rede do aluno, não defeito nosso.
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return SEM_CONEXAO;
  }

  if (error instanceof Error && error.message) return error.message;
  return padrao;
}

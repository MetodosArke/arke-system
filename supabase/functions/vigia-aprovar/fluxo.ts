// A regra do desfecho da aprovação do Vigia, sem Deno nem Supabase, para o
// teste do app exercitar o código real (src/lib/vigiaAprovar.test.ts).
//
// Depois que o banco reserva a decisão (o preparo da aprovação, no index.ts,
// que exige a sessão verificada), a ação fica "executando" até
// `vigia_concluir_acao` registrar o desfecho — e uma segunda
// aprovação é recusada como "já decidida". Por isso toda saída depois da
// reserva registra o desfecho, inclusive a falha: o Asaas ou o webhook que
// estoura o prazo lança exceção no `fetch`, e antes essa exceção pulava o
// registro e deixava a ação presa em "executando" para sempre.

export type Resultado = { resultado: "ok" | "erro" | "ignorada"; detalhe: string; comando_id?: string | null };

export type Preparo = { acao_id: number; ferramenta: string; alvo: unknown; contexto?: unknown };

export type Desfecho = { acao_id: number; resultado: "ok" | "erro"; detalhe: string; comando_id: string | null };

/** O que dizer de uma exceção, sem a mensagem crua (pode trazer endereço ou corpo). */
export function detalheDaFalha(erro: unknown): string {
  const nome = erro instanceof Error ? erro.name : typeof erro;
  if (nome === "TimeoutError" || nome === "AbortError") {
    return "O serviço chamado não respondeu no prazo, e o resultado não foi confirmado. Confira antes de agir de novo.";
  }
  return `A execução falhou antes de terminar (${nome}). Confira antes de agir de novo.`;
}

/**
 * Executa a ação já reservada e registra o desfecho, aconteça o que
 * acontecer. O registro é tentado duas vezes: uma falha de rede passageira
 * no fim não pode deixar a ação presa. Nunca lança.
 */
export async function executarComDesfecho(
  prep: Preparo,
  executar: (prep: Preparo) => Promise<Resultado>,
  concluir: (d: Desfecho) => Promise<{ error: unknown }>,
): Promise<{ resultado: Resultado; registrado: boolean }> {
  let res: Resultado;
  try {
    res = await executar(prep);
  } catch (erro) {
    res = { resultado: "erro", detalhe: detalheDaFalha(erro) };
  }
  // Ordem igual já na fila do Gateway: o que foi aprovado já vai acontecer.
  if (res.resultado === "ignorada") res = { ...res, resultado: "ok" };

  const desfecho: Desfecho = {
    acao_id: prep.acao_id,
    resultado: res.resultado === "ok" ? "ok" : "erro",
    detalhe: res.detalhe,
    comando_id: res.comando_id ?? null,
  };
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const { error } = await concluir(desfecho);
      if (!error) return { resultado: res, registrado: true };
    } catch {
      // tenta de novo
    }
  }
  return { resultado: res, registrado: false };
}

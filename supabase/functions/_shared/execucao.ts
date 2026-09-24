// Registro do desfecho de uma edge function chamada pelo cron — ver
// 20261248010000_vigia_funcoes_agendadas.sql. O cron dispara por
// net.http_post, que não espera a resposta: sem este registro, a função
// quebrada toda hora aparecia como rotina "ok".
//
// Nunca lança. Falhar ao registrar não pode derrubar a função que registra —
// e, se o banco estiver fora, a própria falta de registro vira "atrasada"
// depois de dois intervalos, que é o aviso certo.

type ClienteRpc = { rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> };

export async function registrarExecucao(admin: ClienteRpc, nome: string, ok: boolean, erro?: string): Promise<void> {
  try {
    const { error } = await admin.rpc("registrar_execucao_agendada", {
      _nome: nome,
      _ok: ok,
      _erro: ok ? null : (erro ?? "erro sem mensagem").slice(0, 300),
    });
    if (error) console.error(`${nome}: não foi possível registrar o desfecho`);
  } catch {
    console.error(`${nome}: não foi possível registrar o desfecho`);
  }
}

/** Mensagem de erro que pode ir para o registro: só o tipo e a mensagem, nunca a pilha. */
export function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`.slice(0, 300);
  return typeof erro === "string" ? erro.slice(0, 300) : "erro inesperado";
}

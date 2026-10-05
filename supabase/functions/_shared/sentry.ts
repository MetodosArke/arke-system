// Erro de edge function no Sentry (projeto `edge-functions`), sem SDK.
//
// O que sai é só o que identifica a falha: o nome da função, o status HTTP,
// o tipo do erro, o código (do Postgres ou do PostgREST) e as linhas do
// rastro. A mensagem do erro NÃO sai: uma mensagem do banco pode trazer o
// valor de uma coluna, e o corpo da requisição nunca é lido aqui. É a mesma
// postura de src/lib/monitoramento.ts no app.
//
// Sem o secret SENTRY_DSN_FUNCOES, não faz nada. Falha no envio nunca afeta a
// resposta da função.

import { eventoDeErro } from "./erroServidor.ts";

const PRAZO_MS = 3_000;
/** A mesma falha da mesma função vai uma vez a cada 5 minutos por instância: um laço não gasta a cota. */
const INTERVALO_REPETICAO_MS = 5 * 60_000;
const enviadosEm = new Map<string, number>();

type Destino = { url: string; chave: string };

function destino(): Destino | null {
  const dsn = Deno.env.get("SENTRY_DSN_FUNCOES");
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projeto = u.pathname.replace(/^\//, "");
    if (!u.username || !/^\d+$/.test(projeto)) return null;
    return { url: `${u.protocol}//${u.host}/api/${projeto}/envelope/`, chave: u.username };
  } catch {
    return null;
  }
}

/** Manda ao Sentry. Nunca lança. */
export async function relatarErro(funcao: string, status: number, erro?: unknown): Promise<void> {
  try {
    const alvo = destino();
    if (!alvo) return;
    const evento = eventoDeErro(funcao, status, erro);
    const chave = evento.fingerprint.join("|");
    const ultimo = enviadosEm.get(chave);
    if (ultimo && Date.now() - ultimo < INTERVALO_REPETICAO_MS) return;
    enviadosEm.set(chave, Date.now());
    const envelope = [
      JSON.stringify({ event_id: evento.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(evento),
    ].join("\n");
    await fetch(alvo.url, {
      method: "POST",
      signal: AbortSignal.timeout(PRAZO_MS),
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${alvo.chave}, sentry_client=arke-edge/1.0`,
      },
      body: envelope,
    });
  } catch {
    // Sentry fora não muda nada para quem chamou a função.
  }
}

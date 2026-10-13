/**
 * A chave de idempotência dos e-mails que saem pelo Resend (13/10/2026).
 *
 * Uma repetição — o cliente que tenta de novo, a rotina do pg_cron que roda de
 * novo, o aviso reenviado pelo Auth — mandava o mesmo e-mail duas vezes. O
 * Resend aceita o cabeçalho `Idempotency-Key`: a mesma chave em 24 h devolve
 * a resposta da primeira e não entrega de novo. Duas regras dele moldam a
 * chave:
 *
 * - **até 256 caracteres;**
 * - **a mesma chave com outro conteúdo é recusada com 409.** Por isso o
 *   e-mail cujo corpo muda a cada pedido (o convite, que leva um link novo e
 *   invalida o anterior) entra com o resumo do conteúdo na chave: o mesmo link
 *   não sai duas vezes, e o link novo sai, porque é o único que funciona. E o
 *   409 conta como enviado (`envioAceito`): ele só acontece quando um envio
 *   com a mesma chave já saiu ou está saindo.
 *
 * A chave vai a um serviço de fora: leva só o tipo, ids e datas, nunca e-mail,
 * nome ou CPF. O resumo do conteúdo é um SHA-256 cortado, que não se desfaz.
 * Regra pura, sem Deno: o teste do app exercita este arquivo
 * (`src/lib/idempotenciaEmail.test.ts`), e `emailIdempotente.guarda.test.ts`
 * cobra o cabeçalho em todo envio ao Resend.
 */

export const LIMITE_DA_CHAVE = 256;

// Letras, números e `_ . : -`. Sem `@` (endereço de e-mail), sem espaço (nome
// de gente) e sem `/`, que separa as partes.
const PARTE_VALIDA = /^[A-Za-z0-9_.:-]+$/;

/** `<tipo>/<parte>/<parte>...`, recusando o que não é id, data ou resumo. */
export function chaveDeIdempotencia(tipo: string, ...partes: Array<string | number>): string {
  if (!partes.length) throw new Error("A chave de idempotência precisa de ao menos uma parte além do tipo.");
  const todas = [tipo, ...partes.map(String)];
  for (const parte of todas) {
    if (!PARTE_VALIDA.test(parte)) throw new Error("Parte inválida na chave de idempotência: só ids, datas e resumos.");
  }
  const chave = todas.join("/");
  if (chave.length > LIMITE_DA_CHAVE) throw new Error(`A chave de idempotência passa de ${LIMITE_DA_CHAVE} caracteres.`);
  return chave;
}

/** O resumo (SHA-256, 40 dígitos hexadecimais) dos textos, na ordem dada. */
export async function resumoParaChave(...textos: string[]): Promise<string> {
  const dados = new TextEncoder().encode(textos.join("\u0000"));
  const resumo = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

/** Os cabeçalhos de um envio ao Resend, sempre com a chave. */
export function cabecalhosDoResend(resendKey: string, chave: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": chave };
}

/**
 * O envio saiu? 2xx, ou 409: a mesma chave já foi usada (o e-mail saiu antes)
 * ou está em uso agora (está saindo). Repetir não manda de novo.
 */
export function envioAceito(status: number): boolean {
  return (status >= 200 && status < 300) || status === 409;
}

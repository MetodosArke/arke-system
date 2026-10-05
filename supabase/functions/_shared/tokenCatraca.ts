// Token do Gateway Local: o banco guarda só o SHA-256 (`device_token_hash`),
// e cada função da catraca confere o hash do token que o Gateway mandou.
//
// A conta é a mesma de `public.hash_token_catraca()` no banco: SHA-256 do
// UUID em minúsculas, em hexadecimal. Se uma mudar, as duas mudam juntas.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hash do token, ou null quando o texto nem tem formato de token. Token fora
 * do formato não é de dispositivo nenhum: a função responde 401 sem consultar
 * o banco, e não "falha do servidor" a quem só copiou o token errado.
 */
export async function hashDoTokenCatraca(token: string | null | undefined): Promise<string | null> {
  const t = (token ?? "").trim().toLowerCase();
  if (!UUID.test(t)) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

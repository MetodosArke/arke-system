// O pedido da tela de entrar depois de uma tentativa que falhou: o e-mail
// digitado e o código do erro do Auth. Sem Deno nem Supabase, para o teste do
// app exercitar o código real (`trilhaDeAuditoria.guarda`).

export type FalhaDeLogin = { email: string; motivo: string };

/**
 * O e-mail como o Auth o guarda (sem espaço, em minúsculas) e o código do
 * erro; código fora do formato vira "outro", para nada livre ir ao banco.
 * Nulo quando o pedido não traz um e-mail.
 */
export function lerFalhaDeLogin(corpo: unknown): FalhaDeLogin | null {
  if (!corpo || typeof corpo !== "object") return null;
  const { email, motivo } = corpo as { email?: unknown; motivo?: unknown };
  if (typeof email !== "string") return null;
  const limpo = email.trim().toLowerCase();
  if (limpo.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(limpo)) return null;
  return { email: limpo, motivo: typeof motivo === "string" && /^[a-z0-9_]{1,40}$/.test(motivo) ? motivo : "outro" };
}

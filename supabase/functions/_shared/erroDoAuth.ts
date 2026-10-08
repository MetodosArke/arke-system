// A resposta para um erro do Auth do Supabase (convite, conta nova, troca de
// e-mail), sem a mensagem dele (frente D, 07/10/2026).
//
// A mensagem crua do Auth ia para a tela: "Email address \"x@y\" is
// invalid", "Database error saving new user", o texto de um limite interno.
// Ela pode trazer o e-mail digitado, fala em inglês e descreve o servidor. A
// resposta passa a ser nossa, pelo código e pelo status do erro; a mensagem
// fica de fora até do log, que leva `resumoDoErro()`.
//
// Puro, sem Deno nem Supabase: o teste do app exercita este código.

export type ErroDoAuth = { message?: string | null; status?: number | null; code?: string | null } | null | undefined;

export type RespostaDoErro = { mensagem: string; status: number };

export const JA_CADASTRADO = "Já existe um usuário cadastrado com esse e-mail.";
export const EMAIL_INVALIDO = "O e-mail informado não é válido. Confira o endereço.";
export const MUITOS_PEDIDOS = "Muitos pedidos seguidos. Tente de novo em alguns minutos.";

/** O e-mail já tem conta. O Auth antigo só diz pela mensagem; o novo, pelo código. */
export function emailJaCadastrado(erro: ErroDoAuth): boolean {
  if (!erro) return false;
  if (["email_exists", "user_already_exists", "identity_already_exists"].includes(erro.code ?? "")) return true;
  return /already (been )?registered|already exists/i.test(erro.message ?? "");
}

/**
 * A mensagem e o status da resposta. Pedido inválido (4xx do Auth) responde
 * 400 com `padrao`; falha do Auth (5xx, ou sem status) responde 502: falha
 * nossa e pedido inválido são respostas diferentes.
 */
export function respostaDoErroDoAuth(erro: ErroDoAuth, padrao: string): RespostaDoErro {
  const codigo = erro?.code ?? "";
  const status = typeof erro?.status === "number" ? erro.status : 0;
  if (emailJaCadastrado(erro)) return { mensagem: JA_CADASTRADO, status: 409 };
  if (status === 429 || /^over_.*_rate_limit$/.test(codigo)) return { mensagem: MUITOS_PEDIDOS, status: 429 };
  if (codigo === "email_address_invalid" || /invalid.*e-?mail|e-?mail.*invalid/i.test(erro?.message ?? "")) {
    return { mensagem: EMAIL_INVALIDO, status: 400 };
  }
  if (status >= 400 && status < 500) return { mensagem: padrao, status: 400 };
  return { mensagem: padrao, status: 502 };
}

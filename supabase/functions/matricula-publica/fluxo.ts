// A matrícula pública confirmada pelo e-mail (decisão de 07/10/2026).
//
// Até aqui a função criava a conta com a senha que o visitante digitava e com
// o e-mail já confirmado, sem prova de que o e-mail era dele. Quem fizesse a
// matrícula com o e-mail e o CPF de outra pessoa ficava com uma conta usável,
// com senha conhecida, e a matrícula que outra academia fizesse depois para a
// pessoa de verdade se ligava a essa conta pelo CPF (o pré-sequestro).
//
// Agora, no molde da equipe e da gestão: a conta nasce sem senha e sem o
// e-mail confirmado, marcada como da matrícula pública, e a pessoa recebe o
// link de criar a senha, o mesmo do primeiro acesso. A conta só fica usável
// depois do link, que é a prova de posse do e-mail.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto e a regra de
// verdade.

/**
 * A marca da conta criada pela matrícula pública, em `app_metadata` (que só o
 * servidor grava). O banco a lê para não ligar outra academia à conta que
 * nunca confirmou o e-mail e para apagar a que não confirmou em 7 dias
 * (`conta_da_matricula_publica_nao_confirmada`, migration 20261403010000).
 */
export const ORIGEM_MATRICULA_PUBLICA = "matricula_publica";

/** A rota da tela de criar a senha, a mesma do primeiro acesso e dos convites. */
export const ROTA_DEFINIR_SENHA = "/auth/definir-senha";

/**
 * A tela publicada antes desta regra manda a senha e entra com ela logo
 * depois. A conta nova não tem senha, e a entrada falharia depois de a
 * matrícula estar feita: a pessoa leria "não foi possível" e tentaria de novo.
 * A função recusa antes de criar qualquer coisa, e a página recarregada já é a
 * nova (o app instalado pode guardar a página antiga por um tempo).
 */
export const TELA_ANTIGA =
  "Esta página foi atualizada: agora a senha é criada pelo link que enviamos ao seu e-mail. Recarregue a página e faça a matrícula de novo.";

/**
 * O e-mail que já tem conta continua recusado (409), como antes. O texto
 * acrescenta o caminho de quem ainda não criou a senha (o "Esqueceu a
 * senha?" manda o link para o e-mail, e só o dono do e-mail o recebe) e o de
 * quem quer entrar em mais uma academia com a conta que já tem.
 */
export const CONTA_JA_EXISTE =
  "Já existe uma conta no ArkeFit com esse e-mail. Faça login; se ainda não criou a senha ou não lembra dela, use “Esqueceu a senha?” na tela de entrar. Para usar essa conta também nesta academia, fale com a recepção.";

/** O Auth recusou porque o e-mail já tem conta. */
export function contaJaExiste(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  if (erro.code === "email_exists" || erro.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(erro.message ?? "");
}

/** A tela antiga mandou a senha. */
export function veioDaTelaAntiga(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const senha = (payload as { password?: unknown }).password;
  return typeof senha === "string" && senha.length > 0;
}

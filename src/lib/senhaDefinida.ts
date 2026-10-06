/**
 * O que vem depois de a pessoa definir a senha por um link do e-mail (o
 * convite, a ativação, o "Esqueci minha senha").
 *
 * A conta pode ter sido criada por outra pessoa: a matrícula pública cria a
 * conta com o e-mail já confirmado e a senha de quem se matriculou, sem prova
 * de que é o dono do e-mail. Quem chega por este link provou o e-mail. Então,
 * nesta ordem (auditoria de 05/10/2026, migration 20261362010000):
 *
 * 1. as outras sessões da conta caem, e com elas quem tinha a senha antiga;
 * 2. a gestão que esperava a prova do e-mail (`pending`) é ativada, e desde
 *    20261395010000 também o vínculo pendente de professor, nutricionista e
 *    recepção. O banco só ativa numa sessão aberta por link, e nunca em perfil
 *    simulado.
 *
 * Sem o passo 1, a gestão não é ativada: ativar com a sessão de outra pessoa
 * ainda viva daria o painel a ela.
 */
type ClienteAuth = {
  auth: { signOut(opcoes: { scope: "others" }): PromiseLike<{ error: { message: string } | null }> };
  rpc(funcao: "ativar_gestao_pendente"): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type ResultadoSenhaDefinida =
  | { tipo: "ok"; gestoesAtivadas: number }
  | { tipo: "sessoes_nao_encerradas" }
  | { tipo: "gestao_nao_ativada" };

export async function depoisDeDefinirASenha(cliente: ClienteAuth): Promise<ResultadoSenhaDefinida> {
  const { error: erroSair } = await cliente.auth.signOut({ scope: "others" });
  if (erroSair) return { tipo: "sessoes_nao_encerradas" };

  const { data, error } = await cliente.rpc("ativar_gestao_pendente");
  // Recusa aqui é o caso comum de quem abriu a página com uma sessão de senha
  // (recarregou depois de entrar): não havia o que ativar por este caminho.
  if (error) return { tipo: "gestao_nao_ativada" };
  return { tipo: "ok", gestoesAtivadas: typeof data === "number" ? data : 0 };
}

// Desde 20261395010000 o vínculo pendente pode ser de gestão ou de equipe.
export const AVISO_GESTAO_PENDENTE =
  "A senha foi definida, mas não conseguimos encerrar as outras sessões desta conta, e por isso o acesso (de gestão ou de equipe) que esperava a confirmação do seu e-mail continua pendente. Use “Esqueci minha senha” na tela de entrar para tentar de novo.";

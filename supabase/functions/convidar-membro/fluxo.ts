// O que a matrícula pela academia diz sobre a conta que já existe. Sem Deno e
// sem Supabase, para o teste do app exercitar o texto de verdade.

/**
 * A conta que nasceu na matrícula pública de outra academia e ainda não
 * confirmou o e-mail (decisão de 07/10/2026).
 *
 * A matrícula pela academia liga a conta que já existe quando o CPF digitado
 * é o dela (decisão de 03/10/2026). Mas o CPF da conta da matrícula pública
 * foi digitado por um visitante sem prova nenhuma: até o dono do e-mail criar
 * a senha pelo link, ninguém provou que a conta é dele. Ligar a matrícula
 * nela juntaria o cadastro verdadeiro com o que alguém pode ter inventado,
 * inclusive a academia do link, que passaria a ver o perfil da pessoa.
 *
 * O banco recusa do mesmo jeito (gatilho `trg_matricula_publica_sem_outra_academia`,
 * migration 20261403010000); a função pergunta antes, para dizer o caminho.
 * A matrícula não confirmada é apagada depois de 7 dias, se ficou como nasceu.
 */
export const MATRICULA_ONLINE_NAO_CONFIRMADA =
  "Essa pessoa fez uma matrícula online pelo link de outra academia e ainda não confirmou o e-mail, e a conta só recebe outra matrícula depois disso. Se a matrícula online foi dela, peça para ela criar a senha pelo link que chegou no e-mail (ou pelo “Esqueceu a senha?” na tela de entrar) e cadastre de novo. Se ela não reconhece essa matrícula, não precisa fazer nada: sem a confirmação, ela é apagada depois de 7 dias, e aí o cadastro passa.";

/** O banco recusou o aluno pela mesma regra (versão da função publicada antes desta, ou outro caminho). */
export function recusaDaMatriculaOnline(mensagem: string | null | undefined): boolean {
  return /matrícula online/i.test(mensagem ?? "");
}

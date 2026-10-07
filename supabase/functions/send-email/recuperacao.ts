// O texto do e-mail de recuperação do Auth (o link de definir a senha).
//
// O mesmo e-mail serve ao "Esqueceu a senha?" e, desde 07/10/2026, à
// matrícula pública: a conta da matrícula nasce sem senha, e a pessoa recebe
// este link para criar a primeira (ver matricula-publica/fluxo.ts). O texto de
// sempre ("Redefinir sua senha... Sua senha permanecerá a mesma") não serve a
// quem acabou de se matricular, nem a quem recebe o e-mail sem ter pedido nada
// porque alguém usou o e-mail dele: esse precisa saber que pode ignorar e que
// ninguém entra na conta sem o link.
//
// Sem Deno e sem Supabase, para o teste do app exercitar o texto de verdade.

import { ORIGEM_MATRICULA_PUBLICA } from "../matricula-publica/fluxo.ts";

export type VarianteRecuperacao = "redefinir" | "matricula";

export type TextoRecuperacao = {
  assunto: string;
  titulo: string;
  corpo: string;
  botao: string;
  rodape: string;
};

/** O pedaço do usuário que o hook do Auth manda e que decide o texto. */
export type UsuarioDoHook = {
  email_confirmed_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

/**
 * A conta da matrícula pública que ainda não confirmou o e-mail recebe o texto
 * da matrícula. Qualquer outra (inclusive a da matrícula que já confirmou e
 * esqueceu a senha) recebe o de sempre.
 */
export function varianteDaRecuperacao(usuario: UsuarioDoHook): VarianteRecuperacao {
  const daMatricula = usuario.app_metadata?.origem === ORIGEM_MATRICULA_PUBLICA;
  return daMatricula && !usuario.email_confirmed_at ? "matricula" : "redefinir";
}

/** `siteName` é "app da <academia>" com a marca dela, ou "ArkeFit". */
export function textoDaRecuperacao(variante: VarianteRecuperacao, siteName: string): TextoRecuperacao {
  if (variante === "matricula") {
    return {
      assunto: `Crie a sua senha do ${siteName}`,
      titulo: "Crie a sua senha",
      corpo: `Recebemos uma matrícula no ${siteName} com este e-mail. Para entrar no app, crie a sua senha pelo botão abaixo.`,
      botao: "Criar minha senha",
      rodape:
        "Se não foi você, ignore este e-mail: sem o link, ninguém entra na conta, e a matrícula sem confirmação é apagada depois de 7 dias.",
    };
  }
  return {
    assunto: `Redefinir sua senha do ${siteName}`,
    titulo: "Redefinir sua senha",
    corpo: `Recebemos uma solicitação para redefinir sua senha no ${siteName}. Clique no botão abaixo para escolher uma nova senha.`,
    botao: "Redefinir senha",
    rodape: "Se você não solicitou a redefinição, pode ignorar este e-mail. Sua senha permanecerá a mesma.",
  };
}

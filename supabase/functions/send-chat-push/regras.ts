// Quem avisa quem, e o que vai no aviso. Sem Deno e sem Supabase, para os
// testes do app exercitarem estas regras direto.
//
// O aviso sai no celular com o nome do app e abre o app ao tocar: um título
// "Sua mensalidade venceu, pague aqui" com um link de fora seria o golpe
// perfeito. Por isso o aluno só avisa a equipe da academia dele, o link fica
// preso ao app e o texto tem tamanho máximo.

export const PAPEIS_EQUIPE = ["gestor", "professor", "nutricionista", "recepcao", "admin_arke"];

export const TITULO_MAXIMO = 80;
export const TEXTO_MAXIMO = 180;

const ehEquipe = (papel: string | null | undefined) => !!papel && PAPEIS_EQUIPE.includes(papel);

/** Os papéis pedidos que são da equipe. Aluno nunca recebe aviso em massa. */
export function papeisDaEquipe(papeis: unknown): string[] {
  if (!Array.isArray(papeis)) return [];
  return [...new Set(papeis.filter((p): p is string => typeof p === "string" && ehEquipe(p)))];
}

/**
 * Aviso para uma pessoa: a equipe avisa qualquer um da academia (o aluno, na
 * resposta do chat); o aluno só avisa alguém da equipe.
 */
export function podeAvisarPessoa(papelRemetente: string | null, papelDestinatario: string | null): boolean {
  if (!papelRemetente || !papelDestinatario) return false;
  return ehEquipe(papelRemetente) || ehEquipe(papelDestinatario);
}

/**
 * O endereço que o aviso abre: só caminho do próprio app. Endereço de fora,
 * `//outro.site` ou qualquer coisa estranha vira a página inicial.
 */
export function caminhoDoApp(url: unknown): string {
  if (typeof url !== "string") return "/";
  const u = url.trim();
  if (!u.startsWith("/") || u.startsWith("//") || u.startsWith("/\\") || u.length > 200) return "/";
  if (/[\s\\]/.test(u) || /^\/+[a-z][a-z0-9+.-]*:/i.test(u)) return "/";
  return u;
}

/** Texto do aviso: uma linha, cortado no tamanho máximo. */
export function textoDoAviso(texto: unknown, maximo: number): string {
  if (typeof texto !== "string") return "";
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length > maximo ? `${limpo.slice(0, maximo - 1).trimEnd()}…` : limpo;
}

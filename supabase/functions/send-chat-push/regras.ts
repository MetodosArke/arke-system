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

// ── O canal do mentor (10/10/2026) ─────────────────────────────────────────
//
// Na conversa com o mentor da ArkeFit o aviso não confia no que o app manda:
// o servidor procura a mensagem que quem chama acabou de gravar (lida com o
// RLS dele, que já decide quem fala nessa conversa) e escolhe sozinho quem
// recebe e o que vai escrito. E o aviso não leva trecho: é o canal em que o
// aluno fala da dor e do que não contaria à academia, e a tela bloqueada do
// celular é pública.

/** Quanto tempo depois da mensagem o aviso dela ainda pode sair. */
export const JANELA_MENSAGEM_SEG = 120;

/** A mensagem foi gravada agora há pouco (com 1 minuto de folga para o relógio adiantado). */
export function mensagemRecente(criadaEm: unknown, agora = Date.now()): boolean {
  if (typeof criadaEm !== "string") return false;
  const t = Date.parse(criadaEm);
  return Number.isFinite(t) && agora - t <= JANELA_MENSAGEM_SEG * 1000 && t - agora <= 60_000;
}

export const AVISO_DO_MENTOR = {
  /** O mentor escreveu: vai ao aluno, que acha a conversa na tela de treino. */
  paraAluno: { title: "Nova mensagem do seu mentor ARKE", body: "Toque para ler a conversa.", url: "/#/app/treinos" },
  /** O aluno escreveu: vai a quem atende o Método, na fila da Mentoria. */
  paraMentor: { title: "Nova mensagem de aluno do Método", body: "Toque para abrir a Mentoria.", url: "/#/superadmin/mentoria" },
};

/**
 * Quem recebe o aviso de uma mensagem do canal do mentor.
 *
 * - O mentor escreveu: o aluno.
 * - O aluno escreveu e está no Método: o mentor atribuído a ele, se ainda é
 *   da equipe da Mentoria; sem mentor (ou com um que saiu), toda a equipe da
 *   Mentoria (os sócios e o nível Mentor ativo).
 * - Aluno fora do Método: ninguém, porque o Mentor não lê mais a conversa.
 */
export function destinoNoCanalMentor(
  remetenteTipo: unknown,
  aluno: { user_id: string | null; mentor_id: string | null },
  equipeDaMentoria: string[],
  noMetodo: boolean,
): string[] {
  if (remetenteTipo === "mentor") return aluno.user_id ? [aluno.user_id] : [];
  if (remetenteTipo !== "aluno" || !noMetodo) return [];
  if (aluno.mentor_id && equipeDaMentoria.includes(aluno.mentor_id)) return [aluno.mentor_id];
  return [...new Set(equipeDaMentoria)];
}

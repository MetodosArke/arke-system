/**
 * A paginação do feed por cursor.
 *
 * Até 06/10/2026 o feed lia com `.limit(limite)` e cada "Carregar mais"
 * somava 15 ao limite. Passando de mil, a API devolvia mil com status 200 e o
 * feed parava sem aviso, com o botão ainda na tela. Agora cada página traz 15
 * posts a partir do último da página anterior: a data e, para os posts do
 * mesmo instante, o id. Nenhuma consulta pede mais que 15, e a página 70 sai
 * igual à primeira.
 */

/** O ponto onde a página do feed parou: a data e o id do último post. */
export type CursorFeed = { created_at: string; id: string };

/**
 * O filtro (`.or(...)`) dos posts depois do cursor, na ordem do feed (o mais
 * novo primeiro; o id desempata os posts do mesmo instante). Os valores vão
 * entre aspas: a data tem `:`, `.` e `+`, que a sintaxe do filtro reserva.
 */
export function depoisDoCursor(c: CursorFeed): string {
  return `created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt."${c.id}")`;
}

/** O cursor da próxima página, ou nenhum quando a página veio incompleta (acabou). */
export function proximoCursor(pagina: CursorFeed[], tamanho: number): CursorFeed | undefined {
  if (pagina.length < tamanho) return undefined;
  const ultimo = pagina[pagina.length - 1];
  return { created_at: ultimo.created_at, id: ultimo.id };
}

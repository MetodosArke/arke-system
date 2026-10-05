import type { PostgrestError } from "@supabase/supabase-js";

export const NADA_GRAVADO =
  "Nada foi gravado: o registro não existe mais ou você não tem permissão para alterá-lo. Recarregue a página e tente de novo.";

type Resposta<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * Confere uma gravação (`.update`) pelas linhas que ela devolveu.
 *
 * Quando a regra de acesso recusa a linha, o PostgREST responde sucesso com
 * zero linhas alteradas, sem erro nenhum. Foi assim que o primeiro acesso do
 * aluno ficou nulo para todo mundo, que a meta semanal nunca gravou e que a
 * ArkeFit "alterava" tarefa sem alterar. Pedir as linhas de volta
 * (`.select("id")`) é o único jeito de distinguir "gravou" de "não gravou".
 *
 * Uso: `await exigirGravacao(supabase.from("x").update(dados).eq("id", id).select("id"));`
 */
export async function exigirGravacao<T>(consulta: PromiseLike<Resposta<T>>, mensagem = NADA_GRAVADO): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(mensagem);
  return data;
}

/**
 * A situação do treino de um aluno, para o filtro da lista de alunos.
 * Conta o treino ativo mais recente: sem treino ativo, "sem_treino"; com a
 * validade antes de hoje, "vencido"; sem validade ou dentro dela, "em_dia".
 * `validade_fim` é coluna `date`: compara como texto com a data de Brasília.
 */
export type SituacaoTreino = "em_dia" | "vencido" | "sem_treino";
export type FiltroTreino = "todos" | SituacaoTreino;

export const ROTULO_FILTRO_TREINO: Record<FiltroTreino, string> = {
  todos: "Todos os treinos",
  em_dia: "Com treino em dia",
  vencido: "Treino vencido",
  sem_treino: "Sem treino",
};

export function situacaoDoTreino(treinoAtivo: { validade_fim: string | null } | undefined, hoje: string): SituacaoTreino {
  if (!treinoAtivo) return "sem_treino";
  if (treinoAtivo.validade_fim && treinoAtivo.validade_fim < hoje) return "vencido";
  return "em_dia";
}

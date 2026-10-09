import { DIVISOES, paraGravar, type SerieDetalhe } from "@/lib/seriesTreino";

/**
 * O treino montado do zero, sem modelo da biblioteca (09/10/2026).
 *
 * O professor monta os exercícios na própria tela de publicação e publica
 * direto para o aluno, por `publicar_treino_do_zero` (20261440010000). Os
 * itens ficam só na tela até a publicação: não viram modelo, e a biblioteca
 * da academia não se enche de fichas de um aluno só.
 *
 * Cada item vem do acervo, pelo `exercicio_id`: o banco recusa item sem ele,
 * e é por ele que o app acha os GIFs (`useGifsDoAcervo`). Nome, grupos,
 * equipamento, vídeo e GIF o banco copia do acervo; da tela vão a divisão, as
 * séries, a descrição de execução e a observação.
 */

/** O máximo de exercícios numa publicação, o mesmo do banco. */
export const MAXIMO_DE_ITENS = 150;

export type ItemDoZero = {
  /** Identifica o item na lista da tela (a ordem de inclusão), não vai ao banco. */
  chave: number;
  exercicio_id: string;
  nome_exercicio: string;
  divisao: string;
  series_lista: SerieDetalhe[];
  descricao_execucao: string;
  observacoes: string;
};

/** O item como `publicar_treino_do_zero` recebe. */
export type ItemParaPublicar = {
  exercicio_id: string;
  divisao: string;
  series: number;
  repeticoes: string;
  descanso_seg: number;
  series_detalhe: SerieDetalhe[] | null;
  descricao_execucao: string | null;
  observacoes: string | null;
};

/** A chave do próximo item: uma a mais que a maior da lista (sem sorteio). */
export function proximaChave(itens: Pick<ItemDoZero, "chave">[]): number {
  return itens.reduce((maior, i) => Math.max(maior, i.chave), 0) + 1;
}

/** Os itens na forma do banco, na ordem em que foram incluídos (o banco ordena por divisão). */
export function itensParaPublicar(itens: ItemDoZero[]): ItemParaPublicar[] {
  return itens.map((i) => ({
    exercicio_id: i.exercicio_id,
    divisao: i.divisao,
    // Resumo nos campos antigos + detalhe só quando as séries diferem, como o modelo grava.
    ...paraGravar(i.series_lista),
    descricao_execucao: i.descricao_execucao.trim() || null,
    observacoes: i.observacoes.trim() || null,
  }));
}

/**
 * Por que o treino ainda não pode ser publicado, ou `null`. A mesma conferência
 * do banco, para a tela dizer antes de mandar.
 */
export function problemaDoTreinoDoZero(itens: ItemDoZero[]): string | null {
  if (itens.length === 0) return "Adicione pelo menos um exercício.";
  if (itens.length > MAXIMO_DE_ITENS) return `O treino passa de ${MAXIMO_DE_ITENS} exercícios: divida em mais de uma publicação.`;
  if (itens.some((i) => !i.exercicio_id)) return "Cada exercício do treino vem do acervo.";
  if (itens.some((i) => !(DIVISOES as readonly string[]).includes(i.divisao))) return "Divisão inválida: use de A a J.";
  if (itens.some((i) => i.series_lista.length < 1 || i.series_lista.length > 10)) return "Cada exercício tem de 1 a 10 séries.";
  if (itens.some((i) => i.series_lista.some((s) => !s.reps.trim()))) return "Preencha as repetições de todas as séries.";
  if (itens.some((i) => i.series_lista.some((s) => s.descanso_seg > 3600))) return "O descanso vai até 1 hora (3600 s).";
  return null;
}

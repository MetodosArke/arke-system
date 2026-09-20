/**
 * Processamento de lote com concorrência limitada.
 *
 * A importação de alunos era um `for` com `await` dentro: uma linha por
 * vez, 2 a 4 idas ao servidor por linha, e 400 alunos levando de 10 a 30
 * minutos. Rodar tudo de uma vez com `Promise.all` também não serve — cada
 * convite dispara envio de e-mail pelo Supabase Auth, que tem limite de
 * taxa, e estourar esse limite transforma linha boa em erro.
 *
 * O meio-termo é uma janela fixa de tarefas em voo: rápido o bastante para
 * a operação caber num café, comedido o bastante para não brigar com o
 * limite de envio.
 */

export type ResultadoItem<T> =
  | { ok: true; indice: number; item: T }
  | { ok: false; indice: number; erro: Error };

/**
 * Roda `tarefa` sobre cada item mantendo no máximo `limite` execuções
 * simultâneas.
 *
 * Duas garantias que importam para quem chama:
 *
 * - **uma falha não derruba o lote.** Cada item é capturado
 *   individualmente, porque numa planilha de terceiro a linha ruim é
 *   esperada — abortar tudo por causa de um e-mail malformado obrigaria a
 *   recomeçar do zero;
 * - **a ordem do retorno acompanha a ordem da entrada**, independentemente
 *   da ordem em que terminaram. Sem isso, casar resultado com linha da
 *   planilha viraria adivinhação.
 */
export async function processarComLimite<E, S>(
  itens: E[],
  limite: number,
  tarefa: (item: E, indice: number) => Promise<S>,
  aoConcluirItem?: (resultado: ResultadoItem<S>) => void
): Promise<ResultadoItem<S>[]> {
  if (limite < 1) throw new Error("O limite de concorrência precisa ser pelo menos 1.");

  const resultados: ResultadoItem<S>[] = new Array(itens.length);
  let proximo = 0;

  async function trabalhador() {
    // Cada trabalhador puxa o próximo índice livre até a fila acabar. O
    // incremento é seguro sem trava porque JavaScript roda em uma thread
    // só: não existe preempção entre ler e escrever `proximo`.
    while (proximo < itens.length) {
      const indice = proximo++;
      let resultado: ResultadoItem<S>;
      try {
        resultado = { ok: true, indice, item: await tarefa(itens[indice], indice) };
      } catch (erro) {
        resultado = {
          ok: false,
          indice,
          erro: erro instanceof Error ? erro : new Error(String(erro)),
        };
      }
      resultados[indice] = resultado;
      // Progresso item a item: a tela precisa mostrar avanço durante o
      // lote, não só no fim.
      aoConcluirItem?.(resultado);
    }
  }

  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, () => trabalhador());
  await Promise.all(trabalhadores);

  return resultados;
}

/**
 * Concorrência da importação de alunos.
 *
 * Três, não trinta: o gargalo não é a nossa função, é o envio de e-mail de
 * convite pelo Supabase Auth. Subir isso sem antes confirmar o limite de
 * taxa do SMTP configurado troca lentidão por lote cheio de falha.
 */
export const CONCORRENCIA_IMPORTACAO = 3;

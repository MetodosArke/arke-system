/**
 * Duas travas da API do banco (PostgREST) que cortam dado em silêncio numa
 * academia grande:
 *
 * 1. **Mil linhas por consulta** (`max_rows`). A resposta chega com status 200
 *    e só as primeiras mil — a lista de alunos, a exportação do contador ou a
 *    retenção do mês ficam incompletas sem ninguém saber.
 * 2. **Lista longa no `.in()` vai no endereço da consulta.** Medido em
 *    24/09/2026 na API do projeto: 600 ids passam, 800 voltam 400 e, a partir
 *    de 2.000, 414. Numa academia com uns 700 alunos, a busca dos nomes
 *    falhava e a lista mostrava "—" no lugar de cada nome.
 *
 * Toda leitura que pode passar disso passa por aqui: `todasAsLinhas` lê em
 * páginas de mil e `porLotes` manda os ids em lotes de 200.
 * `paginar.guarda.test.ts` confere que as leituras da academia inteira usam os
 * dois. Espelho de `supabase/functions/_shared/paginar.ts`.
 */
export const TAMANHO_PAGINA = 1000;
export const TAMANHO_LOTE = 200;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

function linhasOuErro<T>(r: Resposta<T> | T[]): T[] {
  if (Array.isArray(r)) return r;
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}

/**
 * Todas as linhas de uma consulta, de mil em mil. A consulta recebe o
 * intervalo e precisa de uma ordem estável (`.order(...)`), senão uma linha
 * pode cair em duas páginas ou em nenhuma.
 */
export async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const pagina = linhasOuErro(await consulta(de, de + TAMANHO_PAGINA - 1));
    linhas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return linhas;
  }
}

/**
 * Uma consulta por lote de 200 ids (sem repetidos), no máximo quatro ao mesmo
 * tempo, e os resultados juntos. Quando cada id pode trazer muitas linhas, a
 * consulta do lote pode ela mesma paginar: devolva `todasAsLinhas(...)`.
 */
export async function porLotes<I, T>(ids: I[], consulta: (lote: I[]) => PromiseLike<Resposta<T> | T[]>): Promise<T[]> {
  const unicos = [...new Set(ids)];
  const lotes: I[][] = [];
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) lotes.push(unicos.slice(i, i + TAMANHO_LOTE));
  const linhas: T[] = [];
  for (let i = 0; i < lotes.length; i += 4) {
    const respostas = await Promise.all(lotes.slice(i, i + 4).map((lote) => consulta(lote)));
    for (const r of respostas) linhas.push(...linhasOuErro(r));
  }
  return linhas;
}

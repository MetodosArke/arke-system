/**
 * A API do banco devolve no máximo 1.000 linhas por consulta (`max_rows` do
 * PostgREST) e não avisa que cortou: a resposta chega com status 200 e as
 * primeiras mil. Numa academia grande, ou numa varredura que atravessa todas,
 * isso vira dado faltando em silêncio. Toda leitura que pode passar disso
 * pagina por aqui.
 *
 * A consulta recebe o intervalo (`de`, `ate`) e precisa de uma ordem estável
 * (`.order(...)`), senão uma linha pode cair em duas páginas ou em nenhuma.
 * Espelho de `src/lib/paginar.ts`: edge function não importa do bundle do app.
 */
export const TAMANHO_PAGINA = 1000;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

export async function todasAsLinhas<T>(consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await consulta(de, de + TAMANHO_PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < TAMANHO_PAGINA) return linhas;
  }
}

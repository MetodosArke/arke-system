import type Datastore from "nedb-promises";

/**
 * Reescreve o arquivo do NeDB só com o que está vivo.
 *
 * O NeDB nunca reescreve uma linha: alterar ou apagar acrescenta uma linha
 * nova no fim do arquivo, e a antiga continua lá até a próxima compactação
 * (que ele faz sozinho só ao abrir o arquivo). Sem isto, o aluno que saiu do
 * cache, com nome e CPF, e o acesso apagado pela retenção continuariam no
 * disco do computador da recepção enquanto o Gateway estivesse ligado —
 * semanas, num computador que ninguém reinicia.
 *
 * `compactDatafileAsync` é do NeDB original, que o nedb-promises expõe pelo
 * proxy sem declarar no tipo.
 */
export async function compactarArquivo<T>(db: Datastore<T>): Promise<void> {
  const original = db as unknown as { compactDatafileAsync?: () => Promise<void> };
  if (typeof original.compactDatafileAsync !== "function") {
    throw new Error("NeDB sem compactDatafileAsync: o arquivo não foi reescrito.");
  }
  await original.compactDatafileAsync();
}

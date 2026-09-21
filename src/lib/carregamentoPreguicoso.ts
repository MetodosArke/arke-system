import { lazy, type ComponentType } from "react";

/**
 * `React.lazy` que sobrevive a um deploy.
 *
 * Com o app dividido por rota, cada página vira um arquivo com hash no nome
 * (`AdminAlunos-3f9a.js`). Quando sai uma versão nova, esses arquivos são
 * substituídos no servidor — e quem estava com a aba aberta desde antes pede,
 * na próxima navegação, um arquivo que não existe mais. O resultado é
 * "Failed to fetch dynamically imported module" e a tela de erro, para alguém
 * que não fez nada de errado.
 *
 * A saída é recarregar a página uma vez: o index.html novo aponta para os
 * arquivos novos. A trava em sessionStorage impede o laço — se a recarga já
 * aconteceu há pouco e o arquivo continua faltando, o problema é outro, e aí o
 * erro segue para o ErrorBoundary (e para o Sentry) em vez de recarregar para
 * sempre.
 */

const CHAVE = "arke:recarga-por-versao-nova";
const JANELA_MS = 30_000;

function recarregouAgora(): boolean {
  try {
    const quando = Number(sessionStorage.getItem(CHAVE) ?? 0);
    return Date.now() - quando < JANELA_MS;
  } catch {
    // Sem sessionStorage (aba privada restrita): sem como travar o laço, então
    // não arrisca recarregar.
    return true;
  }
}

function marcarRecarga() {
  try {
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // idem
  }
}

/** Exportada para teste; a tela usa `paginaPreguicosa`. */
export async function importarComRecarga<T>(
  importar: () => Promise<T>,
  recarregar: () => void = () => window.location.reload()
): Promise<T> {
  try {
    return await importar();
  } catch (erro) {
    if (recarregouAgora()) throw erro;
    marcarRecarga();
    recarregar();
    // A página vai recarregar; esta promessa não precisa resolver.
    return new Promise<T>(() => {});
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function paginaPreguicosa<T extends ComponentType<any>>(importar: () => Promise<{ default: T }>) {
  return lazy(() => importarComRecarga(importar));
}

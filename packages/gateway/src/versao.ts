/**
 * Versão do Gateway Local, reportada à nuvem a cada chamada do canal de
 * comandos. É por ela que a Visão Master mostra qual academia está com
 * Gateway desatualizado — então precisa bater com o package.json, e o teste
 * `versao.test.ts` confere isso.
 */
export const VERSAO_GATEWAY = "1.9.0";

function partes(versao: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(versao.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * A versão está abaixo da mínima? Versão que não se lê não é acusada: o
 * aviso é para atualizar, e um texto estranho não diz para qual versão.
 */
export function versaoAbaixo(versao: string, minima: string | null | undefined): boolean {
  if (!minima) return false;
  const a = partes(versao);
  const b = partes(minima);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

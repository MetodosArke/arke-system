/**
 * Versão do Gateway Local, reportada à nuvem a cada chamada do canal de
 * comandos. É por ela que a Visão Master mostra qual academia está com
 * Gateway desatualizado — então precisa bater com o package.json, e o teste
 * `versao.test.ts` confere isso.
 */
export const VERSAO_GATEWAY = "1.0.0";

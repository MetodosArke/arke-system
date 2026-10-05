import { randomInt } from "node:crypto";

/**
 * Espera com variação: metade fixa, metade sorteada.
 *
 * Quando a nuvem cai, todos os Gateways falham juntos. Com a espera que só
 * dobra, eles voltariam juntos também, no mesmo segundo, a cada rodada, e a
 * nuvem que acabou de voltar receberia todos de uma vez. A metade sorteada
 * espalha as tentativas; a metade fixa mantém o mínimo, para nenhum Gateway
 * martelar.
 */
export function comVariacao(ms: number, sorteio: (maximo: number) => number = (maximo) => randomInt(maximo + 1)): number {
  if (!Number.isFinite(ms) || ms <= 1) return Math.max(0, ms);
  const metade = Math.floor(ms / 2);
  return ms - metade + Math.min(metade, Math.max(0, sorteio(metade)));
}

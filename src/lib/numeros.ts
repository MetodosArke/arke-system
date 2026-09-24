/**
 * Números na tela, do jeito que o Brasil lê: vírgula decimal e ponto de
 * milhar. `toFixed` escreve com ponto ("R$ 125.53", "41.2%") — no financeiro
 * da academia isso é o tipo de detalhe que faz o gestor desconfiar da conta.
 * `numeros.guarda.test.ts` falha se um `toFixed` voltar a ir para a tela.
 */
const aNumero = (valor: number | string | null | undefined) => Number(valor ?? 0);

/** R$ 1.234,56 */
export const reais = (valor: number | string | null | undefined) =>
  aNumero(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** 1.234,5 — com o número exato de casas pedido. */
export const decimal = (valor: number | string | null | undefined, casas = 1) =>
  aNumero(valor).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

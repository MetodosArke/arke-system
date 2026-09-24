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

/**
 * Valor digitado num campo de reais, do jeito que a pessoa escrever:
 * "1.234,56", "1234,56", "80.50", "1.500" ou "R$ 80". Com vírgula, o ponto é
 * milhar; sem vírgula, ponto seguido de três dígitos é milhar e o resto é
 * decimal — "80.50" é oitenta e cinquenta, não oito mil e cinquenta.
 * Devolve NaN quando não dá para ler.
 */
export function lerReais(texto: string): number {
  const t = texto.replace(/R\$/i, "").replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return /^\d{1,3}(\.\d{3})*,\d{0,2}$|^\d+,\d{0,2}$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : NaN;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : NaN;
}

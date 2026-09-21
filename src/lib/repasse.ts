/**
 * Divisão de uma cobrança do Método ARKE entre ArkeFit e academia.
 *
 * A taxa do Asaas sai da parte da ArkeFit (a academia recebe o split em valor
 * fixo), então ela entra no preço de atacado: o repasse é o custo do nível
 * mais a taxa de processamento sobre o valor cobrado. Mesma conta de
 * `asaas-create-subscription` e de `public.arke_taxa_processamento` — se uma
 * mudar, as três mudam juntas.
 */
export type TaxaProcessamento = { percentual: number; fixa: number };

const centavos = (v: number) => Math.round(v * 100) / 100;

export function taxaProcessamento(valor: number, taxa: TaxaProcessamento): number {
  if (!(valor > 0)) return 0;
  return centavos((valor * taxa.percentual) / 100 + taxa.fixa);
}

export function dividirCobranca(valor: number, custoAtacado: number, taxa: TaxaProcessamento) {
  const taxaEstimada = taxaProcessamento(valor, taxa);
  const repasseArke = centavos(custoAtacado + taxaEstimada);
  const liquidoAcademia = centavos(valor - repasseArke);
  return { taxaEstimada, repasseArke, liquidoAcademia, cobreORepasse: liquidoAcademia >= 0 };
}

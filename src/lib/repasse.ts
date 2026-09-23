/**
 * Divisão de uma cobrança do Método ARKE entre ArkeFit e academia.
 *
 * Quanto a ArkeFit retém é negociado **por academia** desde 23/09/2026
 * (`organizations.repasse_tipo` / `repasse_valor`), em valor fixo por aluno ou
 * em percentual do que for cobrado dele. Antes vinha de um custo por nível
 * igual para todo mundo, o que não permitia contrato a contrato.
 *
 * A taxa do Asaas sai da parte da academia, e é por isso que ela é **somada**
 * ao repasse: como a academia recebe valor fixo no split, o que o gateway
 * desconta sai do que sobra — somar a taxa é o que faz a ArkeFit receber o
 * valor negociado limpo. `repasse_valor` é, portanto, o líquido desejado.
 *
 * Mesma conta de `public.repasse_arke` no banco e de `asaas-create-subscription`.
 * Se uma mudar, as três mudam juntas — o teste confere esta contra os mesmos
 * números que a do banco produz.
 */
export type TaxaProcessamento = { percentual: number; fixa: number };

/** O que foi negociado com a academia. `valor` nulo = ainda não negociado. */
export type RepasseConfig = { tipo: "fixo" | "percentual"; valor: number | null };

const centavos = (v: number) => Math.round(v * 100) / 100;

export function taxaProcessamento(valor: number, taxa: TaxaProcessamento): number {
  if (!(valor > 0)) return 0;
  return centavos((valor * taxa.percentual) / 100 + taxa.fixa);
}

/**
 * Quanto a ArkeFit retém de uma cobrança, já com a taxa de processamento.
 * Devolve `null` quando a academia não tem repasse negociado — cair num valor
 * padrão cobraria o aluno com uma divisão que ninguém acordou.
 */
export function repasseArke(valor: number, config: RepasseConfig, taxa: TaxaProcessamento): number | null {
  if (config.valor === null || config.valor === undefined) return null;
  const base = config.tipo === "percentual" ? centavos((valor * config.valor) / 100) : centavos(config.valor);
  return centavos(base + taxaProcessamento(valor, taxa));
}

export function dividirCobranca(valor: number, config: RepasseConfig, taxa: TaxaProcessamento) {
  const taxaEstimada = taxaProcessamento(valor, taxa);
  const repasse = repasseArke(valor, config, taxa);
  if (repasse === null) {
    return {
      taxaEstimada,
      repasseArke: null,
      liquidoAcademia: null,
      cobreORepasse: false,
      semRepasseNegociado: true as const,
    };
  }
  const liquidoAcademia = centavos(valor - repasse);
  return {
    taxaEstimada,
    repasseArke: repasse,
    liquidoAcademia,
    cobreORepasse: liquidoAcademia >= 0,
    semRepasseNegociado: false as const,
  };
}

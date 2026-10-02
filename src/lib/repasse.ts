import { reais } from "./numeros";

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
/**
 * `minima` é o piso por cobrança — a taxa fixa do boleto e do PIX no Asaas.
 * Sem ele, em cobrança abaixo de ~R$ 50 a parte da academia no split passava
 * do valor líquido e o Asaas recusava criar a cobrança (achado no sandbox em
 * 24/09/2026, migration 20261277010000).
 */
export type TaxaProcessamento = { percentual: number; fixa: number; minima?: number };

/** O que foi negociado com a academia. `valor` nulo = ainda não negociado. */
export type RepasseConfig = { tipo: "fixo" | "percentual"; valor: number | null };

const centavos = (v: number) => Math.round(v * 100) / 100;

export function taxaProcessamento(valor: number, taxa: TaxaProcessamento): number {
  if (!(valor > 0)) return 0;
  return centavos(Math.max((valor * taxa.percentual) / 100 + taxa.fixa, taxa.minima ?? 0));
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

/**
 * Qual configuração vale para um nível: a exceção dele, se houver, senão a
 * negociada com a academia.
 *
 * Existe porque a decisão foi manter dois níveis (Integrado e Elite), e eles
 * custam coisas diferentes de servir — Elite entrega acolhimento expandido,
 * encontros periódicos e fila prioritária, que no Mentor Centralizado é tempo
 * de gente. Um repasse só para os dois seria um retrocesso: antes eles já
 * diferiam (R$ 45 e R$ 85).
 *
 * Espelha `public.repasse_arke`. Exceção sem valor não suprime o padrão.
 */
export function resolverRepasse(padrao: RepasseConfig, excecao?: RepasseConfig | null): RepasseConfig {
  if (excecao && excecao.valor !== null && excecao.valor !== undefined) return excecao;
  return padrao;
}

/**
 * A exceção de um nível, lida da linha de `organization_planos_precificacao`.
 * Linha sem valor não é exceção: vale o negociado com a academia. Quem
 * calcula a divisão de um nível passa por aqui e por `resolverRepasse`, senão
 * a tela mostra o padrão onde o Elite tem repasse próprio.
 */
export function excecaoDoNivel(
  linha?: { repasse_tipo: string | null; repasse_valor: number | string | null } | null
): RepasseConfig | null {
  if (!linha || linha.repasse_valor === null || linha.repasse_valor === undefined) return null;
  return { tipo: linha.repasse_tipo === "percentual" ? "percentual" : "fixo", valor: Number(linha.repasse_valor) };
}

/**
 * Confere uma linha da tabela de atacado de referência (Visão Master →
 * Configurações). Devolve o problema em texto, ou `null` quando está boa. O
 * varejo sugerido precisa cobrir a referência mais a taxa: sugestão que não
 * cobre seria recusada na primeira cobrança da academia que a seguisse.
 */
export function conferirAtacado(referencia: number, varejoSugerido: number, taxa: TaxaProcessamento): string | null {
  if (!(referencia > 0)) return "Informe o repasse de referência.";
  if (!(varejoSugerido > 0)) return "Informe o varejo sugerido.";
  const divisao = dividirCobranca(varejoSugerido, { tipo: "fixo", valor: referencia }, taxa);
  if (!divisao.cobreORepasse) {
    return `O varejo sugerido não cobre o repasse de ${reais(divisao.repasseArke)} (referência mais a taxa).`;
  }
  return null;
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

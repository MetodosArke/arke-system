/**
 * Em qual conta Asaas cada cobrança do aluno mora: a da ArkeFit ou a da
 * própria academia (`organizations.cobranca_conta_academia`, 06/10/2026).
 *
 * As regras, num lugar só:
 *   * o Método (`metodo:`) é serviço da ArkeFit e sai sempre da conta dela,
 *     com split de valor fixo para a academia;
 *   * a mensalidade (`plano:`) e a avulsa (`avulsa:`) são da academia. Com o
 *     modo desligado (o padrão), saem da conta da ArkeFit, com split para a
 *     carteira da academia e a taxa de processamento retida. Com o modo
 *     ligado, saem da conta da academia, com a chave dela (a do cofre, a
 *     mesma da nota fiscal), sem split e sem taxa: a tarifa do Asaas é
 *     cobrada direto da academia, e a ArkeFit não fica no meio do dinheiro;
 *   * o modo vale para a cobrança **nova**. A que já existe fica onde nasceu
 *     (`conta_asaas` da matrícula e da avulsa), e é essa coluna que decide
 *     onde cancelar, pausar, trocar o cartão e conferir.
 *
 * Aqui só as decisões, em funções puras, testadas pelo app. Abrir a conta
 * (ler a chave do cofre, conferir a carteira) mora em `contaDaAcademia.ts`.
 */

export type NomeConta = "arkefit" | "academia";
export type OrigemCobranca = "metodo" | "plano" | "avulsa";

/** Onde nasce uma cobrança nova. */
export function contaParaNovaCobranca(origem: OrigemCobranca, cobrancaContaAcademia: boolean | null | undefined): NomeConta {
  if (origem === "metodo") return "arkefit";
  return cobrancaContaAcademia === true ? "academia" : "arkefit";
}

/** A conta gravada numa linha (`conta_asaas`); o que não for "academia" é a da ArkeFit, como sempre foi. */
export function contaDaLinha(conta: string | null | undefined): NomeConta {
  return conta === "academia" ? "academia" : "arkefit";
}

export type Split = { walletId: string; fixedValue: number };

export type Divisao = {
  /** O que a ArkeFit retém. Zero na conta da academia. */
  repasse: number;
  /** O que fica com a academia. */
  liquido: number;
  /** O split que vai ao Asaas; nulo na conta da academia, que recebe o valor inteiro. */
  split: Split[] | null;
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * A divisão de uma cobrança nova da academia (mensalidade ou avulsa).
 *
 * Na conta da ArkeFit, a taxa de processamento fica com ela e o resto vai à
 * carteira da academia em valor fixo. Na conta da academia não há divisão:
 * não existe split para a própria carteira (o Asaas recusa), e a ArkeFit não
 * cobra em nome próprio pelo serviço do Asaas.
 */
export function divisaoDaCobranca(
  conta: NomeConta,
  valor: number,
  taxaProcessamento: number | null,
  walletAcademia: string | null,
): Divisao | { erro: string } {
  if (conta === "academia") return { repasse: 0, liquido: centavos(valor), split: null };
  if (taxaProcessamento === null || !Number.isFinite(taxaProcessamento)) return { erro: "Não foi possível calcular a taxa de processamento." };
  if (!walletAcademia) return { erro: "A academia ainda não configurou a conta de recebimentos no Asaas (Onboarding → Recebimentos)." };
  const repasse = centavos(taxaProcessamento);
  const liquido = centavos(valor - repasse);
  return { repasse, liquido, split: [{ walletId: walletAcademia, fixedValue: liquido }] };
}

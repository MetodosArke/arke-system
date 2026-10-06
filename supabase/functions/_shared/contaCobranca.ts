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
 * As decisões ficam em funções puras, testadas pelo app. `contaDaCobranca`
 * lê a chave do cofre e só importa o tipo do Supabase.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AmbienteAsaas } from "./asaas.ts";
import { carteiraDaChave, chaveCombinaComAmbiente, FalhaIndefinida } from "../nfse-emitir/fluxo.ts";

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

export type ContaCobranca = {
  nome: NomeConta;
  api: string;
  chave: string;
  ambiente: AmbienteAsaas["nome"];
};

export type FalhaConta = { erro: string; status: number };

/** A mensagem de quando falta a chave da academia, que a tela mostra como está. */
export const SEM_CHAVE_DA_ACADEMIA =
  "A cobrança desta academia sai da conta Asaas dela, e a chave dessa conta não está conectada ao ARKE. A gestão conecta em Financeiro → Notas fiscais (Conectar a conta Asaas).";

/**
 * A conta pronta para chamar o Asaas. `ambiente` vem de `ambienteAsaas()` no
 * `index.ts`: é ele quem escolhe sandbox ou produção pelo status da
 * organização, e a chave da academia tem de ser do mesmo ambiente.
 *
 * `conferirCarteira`: para criar cobrança nova, a chave tem de ser da conta
 * que recebe hoje (`asaas_wallet_id`) — senão o dinheiro cairia na conta de
 * outra empresa. Para mexer numa cobrança que já existe, não: ela mora onde
 * nasceu, e a chamada errada responde 404.
 */
export async function contaDaCobranca(
  admin: SupabaseClient,
  ambiente: AmbienteAsaas,
  org: { id: string; asaas_wallet_id?: string | null },
  nome: NomeConta,
  opcoes: { conferirCarteira: boolean },
): Promise<ContaCobranca | FalhaConta> {
  if (nome === "arkefit") return { nome, api: ambiente.api, chave: ambiente.chave, ambiente: ambiente.nome };

  const { data: chave, error } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: org.id });
  if (error) return { erro: "Não foi possível ler a chave da conta Asaas da academia agora. Tente de novo.", status: 500 };
  if (typeof chave !== "string" || !chave) return { erro: SEM_CHAVE_DA_ACADEMIA, status: 422 };
  if (!chaveCombinaComAmbiente(chave, ambiente.nome)) {
    return { erro: "A chave da conta Asaas da academia é de outro ambiente (teste × produção). A gestão conecta a chave certa em Financeiro → Notas fiscais.", status: 409 };
  }
  if (opcoes.conferirCarteira) {
    let carteira: string | null;
    try {
      carteira = await carteiraDaChave(ambiente.api, chave);
    } catch (e) {
      if (e instanceof FalhaIndefinida) return { erro: "Não foi possível falar com o Asaas agora. Tente de novo em instantes.", status: 502 };
      throw e;
    }
    if (!carteira) return { erro: "O Asaas não aceitou a chave da conta da academia agora. Tente de novo; se continuar, a gestão conecta a chave de novo.", status: 502 };
    if (!org.asaas_wallet_id || carteira.trim().toLowerCase() !== org.asaas_wallet_id.trim().toLowerCase()) {
      return { erro: "A chave conectada é de outra conta Asaas, não da que recebe os pagamentos da academia. A gestão conecta a chave da conta certa em Financeiro → Notas fiscais.", status: 409 };
    }
  }
  return { nome, api: ambiente.api, chave, ambiente: ambiente.nome };
}

/**
 * Abre a conta da academia só quando alguém precisar dela (a saída do aluno e
 * o encerramento, em `_shared/encerrarCobrancas.ts`): academia que nunca
 * cobrou na própria conta não paga a leitura do cofre.
 */
export function abridorDaContaDaAcademia(
  admin: SupabaseClient,
  ambiente: AmbienteAsaas,
  organizationId: string,
): () => Promise<{ api: string; chave: string } | { erro: string }> {
  return async () => {
    const r = await contaDaCobranca(admin, ambiente, { id: organizationId }, "academia", { conferirCarteira: false });
    return "erro" in r ? { erro: r.erro } : { api: r.api, chave: r.chave };
  };
}

/** Lembra o cliente do aluno na conta da academia (separado do cliente na conta da ArkeFit). Falhar não perde nada: a próxima busca acha pela referência. */
export async function lembrarClienteDaAcademia(
  admin: SupabaseClient,
  dados: { alunoId: string; organizationId: string; ambiente: AmbienteAsaas["nome"]; customerId: string },
): Promise<void> {
  const { error } = await admin.from("asaas_clientes_academia").upsert(
    {
      aluno_id: dados.alunoId,
      organization_id: dados.organizationId,
      ambiente: dados.ambiente,
      asaas_customer_id: dados.customerId,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "aluno_id,ambiente" },
  );
  if (error) console.error("cliente da conta da academia não foi lembrado", error.code);
}

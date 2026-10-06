/**
 * Abrir a conta Asaas onde a cobrança mora: a da ArkeFit (a chave do
 * ambiente) ou a da academia (a chave do cofre, conferida contra o ambiente e
 * a carteira). As regras de qual conta moram em `contaCobranca.ts`, puras.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AmbienteAsaas } from "./asaas.ts";
import { carteiraDaChave, chaveCombinaComAmbiente, FalhaIndefinida } from "../nfse-emitir/fluxo.ts";
import type { NomeConta } from "./contaCobranca.ts";

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

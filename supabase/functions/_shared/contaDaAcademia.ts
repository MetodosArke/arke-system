/**
 * Abrir a conta Asaas onde a cobrança mora: a da ArkeFit (a chave do
 * ambiente) ou a da academia (a chave do cofre, conferida contra o ambiente e
 * a carteira). As regras de qual conta moram em `contaCobranca.ts`, puras.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AmbienteAsaas } from "./asaas.ts";
import { carteiraDaChave, chaveCombinaComAmbiente, FalhaIndefinida } from "../nfse-emitir/fluxo.ts";
import type { NomeConta } from "./contaCobranca.ts";
import { resumoDoErro } from "./resumoDoErro.ts";
import { gerarTokenWebhook, hashDoTokenWebhook, registrarWebhookNaConta, urlDoWebhookDaAcademia } from "./webhookAcademia.ts";

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

export type ModoLigado = { ok: true; webhook: "registrado" | "atualizado" };

/**
 * Liga a cobrança na conta da academia (`organizations.cobranca_conta_academia`):
 * confere a chave do cofre contra a carteira de hoje, registra o aviso de
 * pagamento (webhook) na conta dela e grava o modo, o hash do token e a
 * auditoria juntos (`definir_cobranca_conta_academia`).
 *
 * É o caminho único de ligar (13/10/2026: o modo é o padrão): a gestão, ao
 * conectar a chave da conta própria (`asaas-fiscal-academia`), e a ArkeFit,
 * pela ficha da organização (`asaas-conta-academia`). Repetir é seguro: o
 * webhook da mesma URL é atualizado, e o token e o hash trocam juntos.
 *
 * Com assinatura de plano viva na conta da ArkeFit, recusa antes de tocar o
 * Asaas (`vivas`), e o banco recusa de novo na mesma transação que liga: o
 * modo vale para a cobrança nova e não migra assinatura.
 */
export async function ligarCobrancaNaContaDaAcademia(
  admin: SupabaseClient,
  ambiente: AmbienteAsaas,
  org: { id: string; asaas_wallet_id?: string | null },
  dados: { supabaseUrl: string; atorId: string },
): Promise<ModoLigado | (FalhaConta & { vivas?: number })> {
  if (!org.asaas_wallet_id) {
    return { erro: "A academia ainda não configurou a conta de recebimentos (Onboarding → Recebimentos).", status: 422 };
  }
  const { count: vivas, error: erroVivas } = await admin
    .from("aluno_matriculas_academia")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("conta_asaas", "arkefit")
    .in("status", ["ativa", "pausada"])
    .not("asaas_subscription_id", "is", null);
  if (erroVivas) return { erro: "Não foi possível conferir as assinaturas agora. Tente de novo.", status: 500 };
  if (vivas) {
    return {
      erro: `Há ${vivas} assinatura(s) de plano viva(s) na conta da ArkeFit para esta academia. O modo vale só para cobrança nova e não migra assinatura: cancele ou deixe terminar essas antes de ligar.`,
      status: 409,
      vivas,
    };
  }
  // A chave da conta da academia (a do cofre, da nota fiscal), conferida
  // contra a carteira que recebe hoje.
  const conta = await contaDaCobranca(admin, ambiente, org, "academia", { conferirCarteira: true });
  if ("erro" in conta) return conta;

  const token = gerarTokenWebhook();
  const registro = await registrarWebhookNaConta(conta.api, conta.chave, {
    url: urlDoWebhookDaAcademia(dados.supabaseUrl, org.id),
    token,
  });
  if (!registro.ok) {
    console.error("contaDaAcademia: o Asaas não registrou o webhook da academia");
    return { erro: `O Asaas não registrou o aviso de pagamento na conta da academia: ${registro.erro}`, status: 502 };
  }
  const { error } = await admin.rpc("definir_cobranca_conta_academia", {
    _organization_id: org.id,
    _ligar: true,
    _ator_user_id: dados.atorId,
    _ambiente: conta.ambiente,
    _token_hash: await hashDoTokenWebhook(token),
    _asaas_webhook_id: registro.id,
  });
  if (error) {
    // P0001: a recusa nossa, com a contagem (assinatura viva na outra conta).
    if (error.code === "P0001") return { erro: error.message, status: 409, vivas: Number(error.details ?? 0) || undefined };
    console.error("contaDaAcademia: falhou ao gravar o modo", resumoDoErro(error));
    return { erro: "Não foi possível gravar a mudança. Tente de novo.", status: 500 };
  }
  return { ok: true, webhook: registro.atualizado ? "atualizado" : "registrado" };
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

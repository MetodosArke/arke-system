/**
 * Encerra no gateway toda cobrança viva de um aluno.
 *
 * Existe porque a saída do aluno acontece por dois caminhos diferentes —
 * exclusão e anonimização LGPD — e os dois deixavam a assinatura cobrando:
 *
 *   * `excluir-aluno` apaga o usuário do Auth, o que faz `cascade` em
 *     `alunos` e daí em `aluno_assinaturas`. O rastro deste lado some, e o
 *     Asaas segue cobrando uma pessoa real todo mês. A varredura de órfãs
 *     detecta e não corrige;
 *   * `anonimizar-aluno` **preserva** os dados financeiros de propósito, para
 *     auditoria fiscal. Preservar o registro é certo; continuar cobrando
 *     alguém que exerceu o direito de apagamento, não.
 *
 * Fica em `_shared` para que a regra seja a mesma nos dois, e para que um
 * terceiro caminho de saída, quando existir, tenha onde se apoiar.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cancelarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";
import { cancelarCobranca, cobrancaPorReferencia } from "../asaas-cobranca-avulsa/fluxo.ts";

type Registro = { id: string; asaas_subscription_id?: string | null; asaas_payment_id?: string | null; conta_asaas?: string | null };

export type Gateway = { api: string; chave: string };

/**
 * A conta da academia, aberta só se alguma cobrança do aluno morar nela
 * (cobrança na conta da academia, `conta_asaas = 'academia'`). Nula ou com
 * erro, a saída para: cancelar na conta errada responderia "não existe", e a
 * cobrança seguiria viva na conta certa.
 */
export type AbrirContaDaAcademia = () => Promise<Gateway | { erro: string }>;

async function gatewayDaLinha(
  linha: Registro,
  arkefit: Gateway,
  academia: AbrirContaDaAcademia | undefined,
  cache: { academia?: Gateway | { erro: string } },
): Promise<Gateway | { erro: string }> {
  if (linha.conta_asaas !== "academia") return arkefit;
  if (!academia) return { erro: "Esta cobrança mora na conta Asaas da academia, e a conta não foi aberta." };
  cache.academia ??= await academia();
  return cache.academia;
}

const VIVAS_ASSINATURA = ["ativa", "atrasada", "pausada"];
// Cancelou no gateway e não conseguiu gravar: parar aqui deixa o registro
// vivo, e a exclusão do aluno segue barrada até alguém tentar de novo.
const GRAVOU_SO_NO_GATEWAY = "A cobrança foi cancelada no gateway, mas o banco não registrou. Tente de novo.";
const VIVAS_MATRICULA = ["ativa", "pausada"];

export type ResultadoEncerramento =
  | { ok: true; canceladas: number }
  | { ok: false; erro: string };

/**
 * @param quem `user_id` de quem pediu, para o rastro do cancelamento; nulo
 *   quando é a rotina (o encerramento da academia, que não tem uma pessoa na hora).
 * @param motivo texto que fica no histórico — a saída precisa se explicar depois.
 * @param contaDaAcademia abre a conta Asaas da academia, para a matrícula e a
 *   avulsa que nasceram nela (`conta_asaas`). O Método mora sempre na conta
 *   da ArkeFit (`gateway`).
 */
export async function encerrarCobrancasDoAluno(
  admin: SupabaseClient,
  alunoId: string,
  gateway: Gateway,
  quem: string | null,
  motivo: string,
  contaDaAcademia?: AbrirContaDaAcademia,
): Promise<ResultadoEncerramento> {
  let canceladas = 0;
  const cache: { academia?: Gateway | { erro: string } } = {};

  // O supabase-js não lança: leitura que falha sem ser conferida viraria
  // "nada a cancelar", e o aluno seguiria cobrado.
  const { data: assinaturas, error: erroAssinaturas } = await admin
    .from("aluno_assinaturas")
    .select("id, asaas_subscription_id")
    .eq("aluno_id", alunoId)
    .in("status", VIVAS_ASSINATURA);
  if (erroAssinaturas) return { ok: false, erro: "Não foi possível ler as assinaturas do aluno." };

  for (const a of (assinaturas ?? []) as Registro[]) {
    if (!a.asaas_subscription_id) continue;
    const r = await cancelarAssinatura(gateway.api, gateway.chave, a.asaas_subscription_id);
    if (!r.ok) {
      // Parar aqui é o certo: seguir com a exclusão deixaria exatamente a
      // órfã que esta função existe para impedir.
      return { ok: false, erro: `Não foi possível cancelar a cobrança no gateway: ${r.erro}` };
    }
    const { error: erroGravar } = await admin
      .from("aluno_assinaturas")
      .update({
        status: "cancelada",
        cancelada_em: new Date().toISOString(),
        cancelada_por: quem,
        cancelamento_motivo: motivo,
        fatura_pendente_url: null,
      })
      .eq("id", a.id);
    if (erroGravar) return { ok: false, erro: GRAVOU_SO_NO_GATEWAY };
    canceladas++;
  }

  const { data: matriculas, error: erroMatriculas } = await admin
    .from("aluno_matriculas_academia")
    .select("id, asaas_subscription_id, conta_asaas")
    .eq("aluno_id", alunoId)
    .in("status", VIVAS_MATRICULA);
  if (erroMatriculas) return { ok: false, erro: "Não foi possível ler as matrículas do aluno." };

  for (const m of (matriculas ?? []) as Registro[]) {
    if (!m.asaas_subscription_id) continue;
    // Na conta onde a mensalidade nasceu.
    const g = await gatewayDaLinha(m, gateway, contaDaAcademia, cache);
    if ("erro" in g) return { ok: false, erro: `Não foi possível abrir a conta Asaas da academia: ${g.erro}` };
    const r = await cancelarAssinatura(g.api, g.chave, m.asaas_subscription_id);
    if (!r.ok) {
      return { ok: false, erro: `Não foi possível cancelar a mensalidade no gateway: ${r.erro}` };
    }
    const { error: erroGravar } = await admin.from("aluno_matriculas_academia").update({ status: "cancelada" }).eq("id", m.id);
    if (erroGravar) return { ok: false, erro: GRAVOU_SO_NO_GATEWAY };
    canceladas++;
  }

  // Cobrança avulsa em aberto (taxa de matrícula, avaliação...): sem isto o
  // Asaas seguiria mandando lembrete de uma fatura a quem saiu. A emissão não
  // confirmada, sem id, é procurada pela referência — pode existir lá.
  const { data: avulsas, error: erroAvulsas } = await admin
    .from("cobrancas_avulsas")
    .select("id, asaas_payment_id, conta_asaas")
    .eq("aluno_id", alunoId)
    .in("status", ["pendente", "atrasado"]);
  if (erroAvulsas) return { ok: false, erro: "Não foi possível ler as cobranças avulsas do aluno." };

  for (const c of (avulsas ?? []) as Registro[]) {
    const g = await gatewayDaLinha(c, gateway, contaDaAcademia, cache);
    if ("erro" in g) return { ok: false, erro: `Não foi possível abrir a conta Asaas da academia: ${g.erro}` };
    let paymentId = c.asaas_payment_id ?? null;
    if (!paymentId) {
      try {
        paymentId = (await cobrancaPorReferencia(g.api, g.chave, `avulsa:${c.id}`))?.id ?? null;
      } catch {
        return { ok: false, erro: "Não foi possível consultar a cobrança avulsa no gateway." };
      }
    }
    if (paymentId) {
      const r = await cancelarCobranca(g.api, g.chave, paymentId);
      if (!r.ok) return { ok: false, erro: `Não foi possível cancelar a cobrança avulsa no gateway: ${r.erro}` };
    }
    const { error: erroGravar } = await admin
      .from("cobrancas_avulsas")
      .update({ status: "cancelado", cancelada_por: quem, cancelada_em: new Date().toISOString() })
      .eq("id", c.id);
    if (erroGravar) return { ok: false, erro: GRAVOU_SO_NO_GATEWAY };
    canceladas++;
  }

  return { ok: true, canceladas };
}

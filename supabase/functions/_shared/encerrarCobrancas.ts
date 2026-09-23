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

import { cancelarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";

type Supabase = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: unknown) => {
        in: (coluna: string, valores: string[]) => Promise<{ data: Registro[] | null }>;
      };
    };
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: unknown) => Promise<{ error: unknown }>;
    };
  };
};

type Registro = { id: string; asaas_subscription_id: string | null };

const VIVAS_ASSINATURA = ["ativa", "atrasada", "pausada"];
const VIVAS_MATRICULA = ["ativa", "pausada"];

export type ResultadoEncerramento =
  | { ok: true; canceladas: number }
  | { ok: false; erro: string };

/**
 * @param quem `user_id` de quem pediu, para o rastro do cancelamento.
 * @param motivo texto que fica no histórico — a saída precisa se explicar depois.
 */
export async function encerrarCobrancasDoAluno(
  admin: Supabase,
  alunoId: string,
  gateway: { api: string; chave: string },
  quem: string,
  motivo: string,
): Promise<ResultadoEncerramento> {
  let canceladas = 0;

  const { data: assinaturas } = await admin
    .from("aluno_assinaturas")
    .select("id, asaas_subscription_id")
    .eq("aluno_id", alunoId)
    .in("status", VIVAS_ASSINATURA);

  for (const a of assinaturas ?? []) {
    if (!a.asaas_subscription_id) continue;
    const r = await cancelarAssinatura(gateway.api, gateway.chave, a.asaas_subscription_id);
    if (!r.ok) {
      // Parar aqui é o certo: seguir com a exclusão deixaria exatamente a
      // órfã que esta função existe para impedir.
      return { ok: false, erro: `Não foi possível cancelar a cobrança no gateway: ${r.erro}` };
    }
    await admin
      .from("aluno_assinaturas")
      .update({
        status: "cancelada",
        cancelada_em: new Date().toISOString(),
        cancelada_por: quem,
        cancelamento_motivo: motivo,
        fatura_pendente_url: null,
      })
      .eq("id", a.id);
    canceladas++;
  }

  const { data: matriculas } = await admin
    .from("aluno_matriculas_academia")
    .select("id, asaas_subscription_id")
    .eq("aluno_id", alunoId)
    .in("status", VIVAS_MATRICULA);

  for (const m of matriculas ?? []) {
    if (!m.asaas_subscription_id) continue;
    const r = await cancelarAssinatura(gateway.api, gateway.chave, m.asaas_subscription_id);
    if (!r.ok) {
      return { ok: false, erro: `Não foi possível cancelar a mensalidade no gateway: ${r.erro}` };
    }
    await admin.from("aluno_matriculas_academia").update({ status: "cancelada" }).eq("id", m.id);
    canceladas++;
  }

  return { ok: true, canceladas };
}

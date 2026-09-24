import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import type { Enums } from "@/integrations/supabase/types";

/**
 * Cobrança avulsa ao aluno: taxa de matrícula, avaliação física, personal,
 * diária, produto. Emitida pela edge function `asaas-cobranca-avulsa`, com o
 * mesmo split da mensalidade.
 */
export type TipoCobrancaAvulsa = Enums<"cobranca_avulsa_tipo">;
export type StatusCobranca = Enums<"status_mensalidade">;

/** Espelho de `DESCRICAO_PADRAO` em `asaas-cobranca-avulsa/fluxo.ts`. */
export const TIPOS_COBRANCA: { valor: TipoCobrancaAvulsa; rotulo: string }[] = [
  { valor: "taxa_matricula", rotulo: "Taxa de matrícula" },
  { valor: "avaliacao_fisica", rotulo: "Avaliação física" },
  { valor: "personal", rotulo: "Aula com personal" },
  { valor: "diaria", rotulo: "Diária" },
  { valor: "produto", rotulo: "Produto" },
  { valor: "outro", rotulo: "Cobrança avulsa" },
];

export const rotuloTipo = (tipo: TipoCobrancaAvulsa) => TIPOS_COBRANCA.find((t) => t.valor === tipo)?.rotulo ?? tipo;

export type CobrancaAvulsa = {
  id: string;
  tipo: TipoCobrancaAvulsa;
  descricao: string;
  valor: number;
  vencimento: string;
  status: StatusCobranca;
  invoice_url: string | null;
  asaas_payment_id: string | null;
  data_pagamento: string | null;
  created_at: string;
};

export type SituacaoCobranca = "emissao_nao_confirmada" | "a_vencer" | "vence_hoje" | "vencida" | "paga" | "cancelada" | "estornada";

/**
 * O que a tela mostra. "Pendente sem id do Asaas" é a emissão que não se
 * confirmou (rede, tempo) — pode existir lá; a tela oferece tentar de novo,
 * que adota a existente em vez de duplicar. Pendente com vencimento passado é
 * vencida mesmo antes de o PAYMENT_OVERDUE chegar.
 */
export function situacaoCobranca(c: Pick<CobrancaAvulsa, "status" | "vencimento" | "asaas_payment_id">, hoje: string): SituacaoCobranca {
  if (c.status === "confirmado") return "paga";
  if (c.status === "cancelado") return "cancelada";
  if (c.status === "estornado") return "estornada";
  if (c.status === "pendente" && !c.asaas_payment_id) return "emissao_nao_confirmada";
  if (c.status === "atrasado" || c.vencimento < hoje) return "vencida";
  if (c.vencimento === hoje) return "vence_hoje";
  return "a_vencer";
}

export const ROTULO_SITUACAO: Record<SituacaoCobranca, string> = {
  emissao_nao_confirmada: "Emissão não confirmada",
  a_vencer: "A vencer",
  vence_hoje: "Vence hoje",
  vencida: "Vencida",
  paga: "Paga",
  cancelada: "Cancelada",
  estornada: "Estornada",
};

/** Em aberto: o que ainda espera pagamento, e por isso pode ser cancelado. */
export const emAberto = (c: Pick<CobrancaAvulsa, "status">) => c.status === "pendente" || c.status === "atrasado";

// --- Chamadas à edge function ------------------------------------------------

export type NovaCobranca = {
  aluno_id: string;
  tipo: TipoCobrancaAvulsa;
  descricao?: string;
  valor: number;
  vencimento?: string;
};

export async function emitirCobrancaAvulsa(nova: NovaCobranca): Promise<{ cobranca_id: string; invoice_url: string | null }> {
  const { data, error } = await supabase.functions.invoke<{ cobranca_id: string; invoice_url: string | null }>(
    "asaas-cobranca-avulsa",
    { body: { acao: "criar", ...nova } },
  );
  if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível emitir a cobrança."));
  return data!;
}

export async function cancelarCobrancaAvulsa(cobrancaId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("asaas-cobranca-avulsa", {
    body: { acao: "cancelar", cobranca_id: cobrancaId },
  });
  if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível cancelar a cobrança."));
}

export async function reemitirCobrancaAvulsa(cobrancaId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("asaas-cobranca-avulsa", {
    body: { acao: "reemitir", cobranca_id: cobrancaId },
  });
  if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível emitir a cobrança."));
}

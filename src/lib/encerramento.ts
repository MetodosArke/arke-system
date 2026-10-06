import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { todasAsLinhas } from "@/lib/paginar";

/**
 * Encerramento de academia, como o Contrato da Academia descreve: aviso com
 * 30 dias, término (cobranças param, digitais saem das catracas, painel só
 * para exportação) e, 30 dias depois, eliminação dos dados. A regra mora no
 * banco (`20261281010000_encerramento_organizacao.sql`); quem executa término
 * e eliminação é a edge function `encerramento-organizacao`.
 */

export type EtapaEncerramento = "aviso" | "encerrada";

export type Encerramento = {
  etapa: EtapaEncerramento;
  iniciativa: "academia" | "arkefit";
  termino_em: string;
  eliminacao_em: string;
  /** Só a gestão e a ArkeFit veem; para o aluno vem nulo. */
  motivo: string | null;
};

export const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Encerramento em curso da academia, ou nulo. */
export async function encerramentoDaAcademia(organizationId: string): Promise<Encerramento | null> {
  const { data, error } = await supabase.rpc("get_encerramento_organizacao", { _organization_id: organizationId });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as Encerramento | undefined) ?? null;
}

export async function avisarEncerramento(
  organizationId: string,
  motivo: string,
  iniciativa: "academia" | "arkefit",
  imediato = false,
): Promise<void> {
  const { error } = await supabase.rpc("avisar_encerramento_organizacao", {
    _organization_id: organizationId,
    _motivo: motivo,
    _iniciativa: iniciativa,
    _imediato: imediato,
  });
  if (error) throw new Error(error.message);
}

export async function retirarEncerramento(organizationId: string): Promise<void> {
  const { error } = await supabase.rpc("retirar_encerramento_organizacao", { _organization_id: organizationId });
  if (error) throw new Error(error.message);
}

/** O desfecho de cada tarefa de remoção fechada na tela do encerramento. */
export const DESFECHO_REMOCAO = {
  apagado: "Apagado do equipamento pela academia depois do encerramento, com as digitais, o rosto e os cartões.",
  ausente: "Conferido no equipamento depois do encerramento: o usuário não estava cadastrado.",
} as const;

export type RemocaoPendente = { id: string; motivo: string; created_at: string };

/**
 * As tarefas de remoção do equipamento ainda abertas: as que o término
 * deixou para a academia (catraca sem gestão remota) e as de ordem ao
 * Gateway que falhou ou expirou.
 */
export async function remocoesPendentes(organizationId: string): Promise<RemocaoPendente[]> {
  // Uma academia grande passa de mil alunos com número na catraca.
  return todasAsLinhas<RemocaoPendente>((de, ate) =>
    supabase
      .from("tarefas")
      .select("id, motivo, created_at")
      .eq("organization_id", organizationId)
      .eq("tipo", "equipamento")
      .in("status", ["aberta", "em_andamento", "aguardando"])
      .order("created_at")
      .order("id")
      .range(de, ate),
  );
}

/** O placar da remoção das digitais, guardado no registro do encerramento. */
export function resumoRemocao(r: {
  remocoes_alunos: number | null;
  remocoes_agendadas: number | null;
  remocoes_remotas_confirmadas: number | null;
  remocoes_manuais: number | null;
  remocoes_manuais_confirmadas: number | null;
}): { texto: string; pendentes: number } {
  const ordens = r.remocoes_agendadas ?? 0;
  const ordensOk = r.remocoes_remotas_confirmadas ?? 0;
  const tarefas = r.remocoes_manuais ?? 0;
  const tarefasOk = r.remocoes_manuais_confirmadas ?? 0;
  const pendentes = Math.max(0, tarefas - tarefasOk);
  const partes = [
    `${r.remocoes_alunos ?? 0} aluno(s) com número na catraca`,
    `${ordensOk} de ${ordens} ordem(ns) ao Gateway confirmada(s)`,
    `${tarefasOk} de ${tarefas} remoção(ões) à mão com desfecho`,
  ];
  return { texto: partes.join(" · "), pendentes };
}

/** A ArkeFit roda agora o que já venceu (o mesmo que a rotina de hora em hora faz). */
export async function executarEncerramentosAgora(): Promise<{ terminos: number; eliminacoes: number; pendentes: number; falhas: number }> {
  const { data, error } = await supabase.functions.invoke("encerramento-organizacao", { body: {} });
  if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível executar o encerramento."));
  return data;
}

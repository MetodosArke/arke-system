import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

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

/** A ArkeFit roda agora o que já venceu (o mesmo que a rotina de hora em hora faz). */
export async function executarEncerramentosAgora(): Promise<{ terminos: number; eliminacoes: number; pendentes: number; falhas: number }> {
  const { data, error } = await supabase.functions.invoke("encerramento-organizacao", { body: {} });
  if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível executar o encerramento."));
  return data;
}

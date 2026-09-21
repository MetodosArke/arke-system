import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Saúde das rotinas do pg_cron — ver public.get_superadmin_rotinas(). */

export interface Rotina {
  nome: string;
  agendamento: string;
  ativa: boolean;
  situacao: "ok" | "falhou" | "atrasada" | "nunca_rodou" | "desativada";
  ultima_execucao: string | null;
  ultimo_erro: string | null;
  falhas_7d: number;
  execucoes_7d: number;
}

export const PRECISA_ATENCAO = new Set(["falhou", "atrasada", "nunca_rodou"]);

export const ROTULO: Record<Rotina["situacao"], string> = {
  ok: "ok",
  falhou: "falhou",
  atrasada: "parou de rodar",
  nunca_rodou: "nunca rodou",
  desativada: "desativada",
};

export function useSaudeRotinas() {
  return useQuery({
    queryKey: ["superadmin-rotinas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_rotinas");
      if (error) throw error;
      return (data ?? []) as Rotina[];
    },
    // As mais frequentes rodam de hora em hora; 5 min basta para o aviso
    // aparecer cedo sem martelar o banco.
    refetchInterval: 5 * 60 * 1000,
  });
}

export function rotinasComProblema(rotinas: Rotina[] | undefined): Rotina[] {
  return (rotinas ?? []).filter((r) => PRECISA_ATENCAO.has(r.situacao));
}

// --- Reconciliação Asaas ↔ banco -------------------------------------------

export interface Reconciliacao {
  executada_em: string;
  cobrancas_verificadas: number;
  divergencias: number;
  corrigidas: number;
  assinaturas_orfas: number;
  erro: string | null;
}

/** Última varredura diária (o modo "aluno" não conta: é pontual). */
export function useUltimaReconciliacao() {
  return useQuery({
    queryKey: ["superadmin-ultima-reconciliacao"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reconciliacoes_asaas")
        .select("executada_em, cobrancas_verificadas, divergencias, corrigidas, assinaturas_orfas, erro")
        .eq("modo", "varredura")
        .order("executada_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Reconciliacao | null;
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * O que na reconciliação merece a faixa vermelha, ou nulo. Varredura sem
 * registro não alarma sozinha: quem acusa "nunca rodou" é a saúde da rotina
 * arke-reconciliacao-asaas.
 */
export function problemaReconciliacao(r: Reconciliacao | null | undefined, agora = Date.now()): string | null {
  if (!r) return null;
  if (r.erro) return "A última reconciliação com o Asaas terminou com erro";
  if (r.assinaturas_orfas > 0) {
    return r.assinaturas_orfas === 1
      ? "1 assinatura ativa no Asaas sem registro no ARKE — o aluno pode estar sendo cobrado sem ninguém ver"
      : `${r.assinaturas_orfas} assinaturas ativas no Asaas sem registro no ARKE — alunos podem estar sendo cobrados sem ninguém ver`;
  }
  // Diária: mais de 50 h sem varredura é uma rodada perdida, com folga.
  if (agora - new Date(r.executada_em).getTime() > 50 * 60 * 60 * 1000) {
    return "A reconciliação com o Asaas não roda há mais de dois dias";
  }
  return null;
}

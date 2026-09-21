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

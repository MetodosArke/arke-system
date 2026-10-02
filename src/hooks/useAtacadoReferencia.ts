import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";

export type NivelAtacado = { id: Enums<"nivel_atacado">; referencia: number; varejoSugerido: number };

/**
 * A tabela de atacado de referência do Método ARKE (Visão Master →
 * Configurações): por nível vendável, quanto a ArkeFit fica de cada aluno e o
 * preço sugerido ao aluno. É o ponto de partida da negociação, não o repasse
 * que vale na cobrança — esse é o da academia (`repasse_arke()`).
 */
export function useAtacadoReferencia() {
  return useQuery({
    queryKey: ["atacado-referencia"],
    queryFn: async (): Promise<NivelAtacado[]> => {
      const { data, error } = await supabase
        .from("planos_atacado")
        .select("id, custo_mensal, valor_sugerido_varejo")
        .eq("disponivel", true);
      if (error) throw error;
      return data
        .map((p) => ({ id: p.id, referencia: Number(p.custo_mensal), varejoSugerido: Number(p.valor_sugerido_varejo) }))
        .sort((a, b) => a.referencia - b.referencia);
    },
  });
}

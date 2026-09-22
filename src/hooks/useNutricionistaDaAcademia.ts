import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * A academia tem nutricionista ativa na equipe? No plano Free, é isso que
 * libera o chat com a nutricionista (decisão de 22/09/2026): a academia paga a
 * profissional, então o ARKE não esconde o chat. Sem nutricionista, o chat
 * mostra o Método ARKE.
 */
export function useNutricionistaDaAcademia(organizationId: string | null | undefined) {
  const { data = false } = useQuery({
    queryKey: ["academia-tem-nutricionista", organizationId],
    queryFn: async () => {
      const { data: tem, error } = await supabase.rpc("academia_tem_nutricionista", { _organization_id: organizationId! });
      if (error) throw error;
      return !!tem;
    },
    enabled: !!organizationId,
    staleTime: 10 * 60_000,
  });
  return data;
}

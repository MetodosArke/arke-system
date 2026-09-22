import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Grupos musculares e equipamentos do acervo, lidos do banco (listas globais
 * mantidas pela ArkeFit). Antes os grupos eram uma lista fixa no código, com 7
 * nomes; hoje a lista é editável sem deploy.
 */
export function useListasAcervo() {
  const grupos = useQuery({
    queryKey: ["grupos-musculares"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos_musculares").select("nome, ordem").order("ordem");
      if (error) throw error;
      return (data ?? []).map((g) => g.nome);
    },
    staleTime: 10 * 60_000,
  });
  const equipamentos = useQuery({
    queryKey: ["equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("equipamentos").select("nome, ordem").order("ordem");
      if (error) throw error;
      return (data ?? []).map((e) => e.nome);
    },
    staleTime: 10 * 60_000,
  });
  return { grupos: grupos.data ?? [], equipamentos: equipamentos.data ?? [] };
}

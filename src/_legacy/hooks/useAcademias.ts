import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Academia {
  id: string;
  nome: string;
}

export function useAcademias() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["academias"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academias" as any)
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data || []) as unknown as Academia[];
    },
  });

  const addAcademia = async (nome: string): Promise<Academia | null> => {
    const trimmed = nome.trim();
    if (!trimmed) return null;
    const existing = (query.data || []).find(
      (a) => a.nome.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;
    const { data, error } = await supabase
      .from("academias" as any)
      .insert({ nome: trimmed })
      .select("id, nome")
      .single();
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ["academias"] });
    return data as unknown as Academia;
  };

  return { academias: query.data || [], isLoading: query.isLoading, addAcademia };
}

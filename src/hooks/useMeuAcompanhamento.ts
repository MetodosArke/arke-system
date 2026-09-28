import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Prescricao = { dono: string; registro: string | null; prescritor: string | null } | null;
export type MeuAcompanhamento = {
  no_metodo: boolean;
  mentor_nome: string | null;
  treino: Prescricao;
  dieta: Prescricao;
};

/** Quem acompanha o aluno e quem assinou o treino e a dieta que ele segue. */
export function useMeuAcompanhamento() {
  const { alunoId } = useAuth();
  return useQuery({
    queryKey: ["meu-acompanhamento", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_meu_acompanhamento", { _aluno_id: alunoId! });
      if (error) throw error;
      return data as unknown as MeuAcompanhamento;
    },
    enabled: !!alunoId,
  });
}

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface MediaTurma {
  mediaEngajamento: number;
  mediaPerformance: number;
  mediaTotal: number;
  totalAlunos: number;
  isLoading: boolean;
}

export function useMediaTurma(
  year: number,
  month: number,
  userEngajamento: number,
  userPerformance: number,
  userTotal: number,
  userIsLoading: boolean
): MediaTurma {
  const { user } = useAuth();

  // Upsert user's score to cache whenever it changes
  useEffect(() => {
    if (!user?.id || userIsLoading || userTotal === 0) return;

    const upsertScore = async () => {
      await supabase
        .from("pontuacao_cache" as any)
        .upsert(
          {
            user_id: user.id,
            ano: year,
            mes: month,
            engajamento: userEngajamento,
            performance: userPerformance,
            total: userTotal,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: "user_id,ano,mes" }
        );
    };

    upsertScore();
  }, [user?.id, year, month, userEngajamento, userPerformance, userTotal, userIsLoading]);

  // Fetch class averages
  const { data, isLoading } = useQuery({
    queryKey: ["media-turma", year, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pontuacao_turma", {
        p_ano: year,
        p_mes: month,
      });
      if (error) throw error;
      return data as any;
    },
    enabled: !!user,
    refetchInterval: 60000, // refetch every minute
  });

  return {
    mediaEngajamento: data?.media_engajamento ?? 0,
    mediaPerformance: data?.media_performance ?? 0,
    mediaTotal: data?.media_total ?? 0,
    totalAlunos: data?.total_alunos ?? 0,
    isLoading,
  };
}

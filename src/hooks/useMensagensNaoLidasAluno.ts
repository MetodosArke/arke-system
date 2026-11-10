import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type NaoLidasAluno = { mentor: number; treino: number; dieta: number };

/**
 * Mensagens da equipe ou do mentor que o aluno ainda não leu, por conversa.
 * A home usa para a Próxima Ação (canalDaMensagemNova) e o menu para o
 * sinal em Treino (mentor e treinador) e em Dieta: uma consulta só, na
 * mesma chave que os chats invalidam ao marcar como lida. A nutrição conta
 * só a conversa da dieta mais recente, a mesma que o chat abre; as das
 * dietas antigas ficariam "não lidas" para sempre. Relida a cada minuto.
 */
export function useMensagensNaoLidasAluno() {
  const { alunoId } = useAuth();
  return useQuery({
    queryKey: ["aluno-mensagem-nova", alunoId],
    queryFn: async (): Promise<NaoLidasAluno> => {
      const contar = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };
      const { data: dietas, error: erroDieta } = await supabase
        .from("dietas")
        .select("id")
        .eq("aluno_id", alunoId!)
        .order("created_at", { ascending: false })
        .limit(1);
      if (erroDieta) throw erroDieta;
      const dietaId = dietas?.[0]?.id;
      const [mentor, treino, dieta] = await Promise.all([
        contar(
          supabase
            .from("mensagens_mentor")
            .select("id", { count: "exact", head: true })
            .eq("aluno_id", alunoId!)
            .eq("remetente_tipo", "mentor")
            .eq("lida", false),
        ),
        contar(
          supabase
            .from("mensagens_treino")
            .select("id", { count: "exact", head: true })
            .eq("aluno_id", alunoId!)
            .eq("remetente_tipo", "treinador")
            .eq("lida", false),
        ),
        dietaId
          ? contar(
              supabase
                .from("mensagens_dieta")
                .select("id", { count: "exact", head: true })
                .eq("dieta_id", dietaId)
                .eq("remetente_tipo", "nutricionista")
                .eq("lida", false),
            )
          : 0,
      ]);
      return { mentor, treino, dieta };
    },
    enabled: !!alunoId,
    refetchInterval: 60_000,
  });
}

/** Quantas não lidas cada item do menu do aluno sinaliza. A conversa com o mentor fica na tela de treino. */
export function naoLidasDoMenu(n: NaoLidasAluno | undefined): Record<string, number> {
  if (!n) return {};
  return { "/app/treinos": n.mentor + n.treino, "/app/dieta": n.dieta };
}

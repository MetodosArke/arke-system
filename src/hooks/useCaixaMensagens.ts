import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { canaisDoPapel } from "@/lib/conversaComAluno";

export type ConversaCaixa = {
  aluno_id: string;
  aluno_nome: string;
  canal: "treino" | "dieta";
  dieta_id: string | null;
  ultima_mensagem: string;
  ultima_em: string;
  ultimo_remetente: string;
  nao_lidas: number;
  /** free, integrado ou elite — o banco já ordena: Elite fura a fila, Integrado antes do Free. */
  plano: string;
};

// A regra dos canais por papel mora em `@/lib/conversaComAluno`, junto com a
// da fila de atendimento; continua exportada daqui para quem já a lia.
export { canaisDoPapel };

/**
 * Conversas dos alunos com a equipe, com o número de mensagens do aluno ainda
 * não lidas. Antes o chat só aparecia abrindo a ficha de cada aluno — mensagem
 * nova não avisava ninguém. Atualiza a cada 30 s; o menu usa o total.
 */
export function useCaixaMensagens() {
  const { organization, organizationRole } = useAuth();
  const canais = canaisDoPapel(organizationRole);

  const consulta = useQuery({
    queryKey: ["caixa-mensagens", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_caixa_mensagens", { _organization_id: organization!.id });
      if (error) throw error;
      return (data ?? []) as ConversaCaixa[];
    },
    enabled: !!organization?.id,
    refetchInterval: 30_000,
  });

  const conversas = (consulta.data ?? []).filter((c) => canais.includes(c.canal));
  const naoLidas = conversas.reduce((soma, c) => soma + Number(c.nao_lidas), 0);
  return { ...consulta, conversas, naoLidas, canais };
}

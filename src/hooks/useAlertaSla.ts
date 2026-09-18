import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export type TipoAlertaSla = "dor" | "barreira";

const ALERTA_CONFIG: Record<TipoAlertaSla, { motivo: string; prioridade: "critica" | "media"; slaHoras: number }> = {
  dor: { motivo: "Aluno relatou dor/desconforto", prioridade: "critica", slaHoras: 24 },
  barreira: { motivo: "Aluno relatou problema de rotina", prioridade: "media", slaHoras: 48 },
};

// Gera diretamente uma tarefa prioritária na Minha Fila do professor
// responsável — reaproveita a policy de INSERT que já permite o aluno
// criar suas próprias tarefas (ver migration da anamnese de onboarding).
export function useAlertaSla() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ tipo, descricao }: { tipo: TipoAlertaSla; descricao: string }) => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const config = ALERTA_CONFIG[tipo];
      const { error } = await supabase.from("tarefas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        motivo: `${config.motivo}: ${descricao}`,
        prioridade: config.prioridade,
        sla_prazo: new Date(Date.now() + config.slaHoras * 60 * 60 * 1000).toISOString(),
        origem_evento: `alerta_${tipo}:${alunoId}:${Date.now()}`,
        tipo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Alerta enviado!", description: "Sua equipe foi avisada e já vai te dar retorno." });
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível enviar o alerta", description: error.message, variant: "destructive" });
    },
  });
}

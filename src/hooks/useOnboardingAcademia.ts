import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { minutosRestantes, percentualConcluido, proximaEtapa, type StatusEtapa } from "@/lib/onboardingAcademia";

/** Checklist do onboarding da academia, lido do estado real no banco. */
export function useOnboardingAcademia() {
  const { organization } = useAuth();
  const consulta = useQuery({
    queryKey: ["onboarding-academia", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_onboarding_organizacao", { _organization_id: organization!.id });
      if (error) throw error;
      return (data ?? []) as StatusEtapa[];
    },
    enabled: !!organization?.id,
  });
  const status = consulta.data ?? [];
  return {
    ...consulta,
    status,
    percentual: percentualConcluido(status),
    proxima: proximaEtapa(status),
    minutos: minutosRestantes(status),
    tudoPronto: status.length > 0 && status.every((s) => s.concluida),
  };
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Em qual conta Asaas a cobrança nova da academia nasce: a da ArkeFit (com
 * split e a taxa de processamento) ou a da própria academia
 * (`organizations.cobranca_conta_academia`, ligado só pela ArkeFit). A prévia
 * da cobrança muda: na conta da academia não há taxa da ArkeFit, e a tarifa
 * do Asaas é cobrada pelo Asaas direto da academia.
 *
 * O Método não passa por aqui: ele mora sempre na conta da ArkeFit.
 */
export function useCobrancaNaContaDaAcademia(organizationId: string | null | undefined, ativo = true) {
  return useQuery({
    queryKey: ["cobranca-conta-academia", organizationId],
    enabled: !!organizationId && ativo,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("cobranca_conta_academia")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data?.cobranca_conta_academia === true;
    },
  });
}

/** O interruptor das subcontas abertas pela ArkeFit (BaaS), pela função do banco: a gestão não lê `plataforma_config`. */
export function useSubcontasBaasLigadas(ativo = true) {
  return useQuery({
    queryKey: ["asaas-subcontas-baas"],
    enabled: ativo,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("asaas_subcontas_baas_ligadas");
      if (error) throw error;
      return data === true;
    },
  });
}

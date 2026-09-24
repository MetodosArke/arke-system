import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TaxaProcessamento } from "@/lib/repasse";

/**
 * A taxa de processamento configurada (Visão Master → Configurações), para a
 * prévia da divisão nas telas. Quem cobra de verdade é o banco
 * (`arke_taxa_processamento`), com a mesma regra de `taxaProcessamento`.
 */
export function useTaxaProcessamento(habilitado = true) {
  return useQuery({
    queryKey: ["taxa-processamento-config"],
    queryFn: async (): Promise<TaxaProcessamento> => {
      const { data, error } = await supabase.rpc("arke_taxa_processamento_config");
      if (error) throw error;
      const linha = data?.[0];
      return { percentual: Number(linha?.percentual ?? 0), fixa: Number(linha?.fixa ?? 0), minima: Number(linha?.minima ?? 0) };
    },
    enabled: habilitado,
  });
}

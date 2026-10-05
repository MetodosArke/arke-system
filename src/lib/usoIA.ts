import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { decimal } from "@/lib/numeros";

/**
 * Visão Master → Uso das IAs: o medidor de cada IA (menos o Sentinela, que
 * segue congelado), lido de `public.get_superadmin_uso_ia()`.
 */

export type UsoIAAgente = {
  agente: string;
  chamadas: number;
  ok: number;
  recusadas_trava: number;
  indisponiveis: number;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: number;
  latencia_media_ms: number | null;
  latencia_max_ms: number | null;
  sem_preco: boolean;
};

export const AGENTES_IA: Record<string, { nome: string; trava: string }> = {
  leticia: { nome: "Letícia (comercial)", trava: "espelho com número, preço, promessa ou link" },
  assistente: { nome: "Assistente da academia", trava: "resposta com número que não está na Central de Ajuda" },
  dieta_pdf: { nome: "Leitura de dieta em PDF", trava: "alimento ou quantidade que não está no PDF, ou leitura que não montou" },
  vigia: { nome: "Vigia (análise)", trava: "quadro que não passou na validação, ou resposta fora do catálogo" },
};

export function nomeDoAgente(agente: string): string {
  return AGENTES_IA[agente]?.nome ?? agente;
}

/** Parte das chamadas que a trava recusou, em %; sem chamada, nada. */
export function taxaDeRecusa(l: Pick<UsoIAAgente, "chamadas" | "recusadas_trava">): number | null {
  return l.chamadas > 0 ? Math.round((l.recusadas_trava / l.chamadas) * 100) : null;
}

/** Custo em dólar: abaixo de um centavo, mostra que é menos de um centavo. */
export function custoEmDolar(valor: number): string {
  if (valor <= 0) return "US$ 0";
  if (valor < 0.01) return "menos de US$ 0,01";
  return `US$ ${decimal(valor, 2)}`;
}

export function milhares(n: number): string {
  return n.toLocaleString("pt-BR");
}

export function useUsoIA(dias: number) {
  return useQuery({
    queryKey: ["superadmin-uso-ia", dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_uso_ia", { _dias: dias });
      if (error) throw error;
      return ((data ?? []) as UsoIAAgente[]).map((l) => ({
        ...l,
        custo_usd: Number(l.custo_usd),
        tokens_entrada: Number(l.tokens_entrada),
        tokens_saida: Number(l.tokens_saida),
      }));
    },
  });
}

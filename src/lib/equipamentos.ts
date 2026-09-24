import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SituacaoGateway } from "@/lib/gateway";

/** Uma catraca de qualquer academia, como a Visão Master vê — ver public.get_superadmin_equipamentos(). */
export interface EquipamentoGlobal {
  catraca_id: string;
  organization_id: string;
  academia: string;
  catraca: string;
  status_catraca: string;
  situacao: SituacaoGateway;
  versao: string | null;
  modelo: string | null;
  estado: string | null;
  fila_offline: number | null;
  cache_alunos: number | null;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  equipamentos: unknown;
  ponte: unknown;
  capacidades: string[];
  reportado_em: string | null;
  ultimo_heartbeat_em: string | null;
  comandos_pendentes: number;
  comandos_falhos_7d: number;
  acessos_hoje: number;
  contingencias_7d: number;
  checkins_parceiro_mes: number;
}

export function useEquipamentosGlobais() {
  return useQuery({
    queryKey: ["superadmin-equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_equipamentos");
      if (error) throw error;
      return (data ?? []) as unknown as EquipamentoGlobal[];
    },
    // Gateway 1.0 reporta a cada ~20 s; um minuto basta para a faixa e a lista.
    refetchInterval: 60_000,
  });
}

/**
 * Catracas que merecem a faixa vermelha: ativas, com Gateway 1.0 (que reporta
 * de verdade) e sem sinal. O Gateway anterior fica de fora pela mesma razão
 * do alerta por e-mail: o sinal dele é de 5 em 5 minutos e avisaria à toa.
 */
export function catracasSemSinal(lista: EquipamentoGlobal[] | undefined): EquipamentoGlobal[] {
  return (lista ?? []).filter((e) => e.status_catraca === "ativo" && e.reportado_em && e.situacao === "offline");
}

/** Ordem da lista: o que precisa de ação primeiro. */
const PESO: Record<SituacaoGateway, number> = { offline: 0, contingencia: 1, nunca_conectou: 2, online: 3, desativada: 4 };
export function ordenarEquipamentos(lista: EquipamentoGlobal[]): EquipamentoGlobal[] {
  return [...lista].sort(
    (a, b) =>
      PESO[a.situacao] - PESO[b.situacao] ||
      b.comandos_falhos_7d - a.comandos_falhos_7d ||
      a.academia.localeCompare(b.academia) ||
      a.catraca.localeCompare(b.catraca)
  );
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Prazo padrão do período de testes, em dias.
 *
 * A política mora no banco (`public.arke_trial_dias()`), que é quem preenche
 * `organizations.trial_vencimento` e o default de `aluno_assinaturas.trial_fim`.
 * Duplicar o número aqui faria a tela mentir no dia em que o prazo mudasse no
 * SQL, então a UI lê a mesma fonte. O fallback existe só para o texto de apoio
 * não sumir se a chamada falhar — nenhuma decisão de cobrança depende dele.
 */
export const TRIAL_DIAS_FALLBACK = 15;

export function useTrialDias() {
  const { data } = useQuery({
    queryKey: ["arke-trial-dias"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("arke_trial_dias");
      if (error) throw error;
      return data as number;
    },
    // Constante de política: não faz sentido revalidar a cada foco de janela.
    staleTime: 1000 * 60 * 60,
  });
  return data ?? TRIAL_DIAS_FALLBACK;
}

/**
 * "Vence em 04/10" obriga quem lê a fazer a conta de cabeça. O que decide se
 * o time liga hoje ou semana que vem é quantos dias faltam.
 */
export function descreverPrazoTrial(vencimento: string): string {
  // Datas `date` do Postgres chegam como "YYYY-MM-DD"; comparar em UTC evita
  // que o fuso do navegador jogue o resultado um dia para trás.
  const hoje = new Date();
  const hojeUtc = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const [ano, mes, dia] = vencimento.slice(0, 10).split("-").map(Number);
  const dias = Math.round((Date.UTC(ano, mes - 1, dia) - hojeUtc) / 86_400_000);

  if (dias < 0) return `vencido há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}`;
  if (dias === 0) return "vence hoje";
  return dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
}

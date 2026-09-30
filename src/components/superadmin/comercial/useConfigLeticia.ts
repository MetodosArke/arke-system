import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ConfiguracaoLeticia = {
  /** Ligada em Visão Master (precisa do link da agenda). */
  ativo: boolean;
  /** A frase da IA, ligada pela Política que a descreve. */
  ia: boolean;
  /** Pode ser acionada para WhatsApp, telefone, indicação e prospecção: ligada pela Política que descreve esses canais. */
  outrasOrigens: boolean;
  agenda: string | null;
  assinatura: string | null;
  responderPara: string | null;
};

export const CHAVE_CONFIG_LETICIA = ["agente-comercial-config"];

/** A configuração da Letícia, lida uma vez para o painel e para os cartões do quadro. */
export function useConfigLeticia() {
  return useQuery({
    queryKey: CHAVE_CONFIG_LETICIA,
    queryFn: async (): Promise<ConfiguracaoLeticia> => {
      const [numeros, textos] = await Promise.all([
        supabase
          .from("plataforma_config")
          .select("chave, valor")
          .in("chave", ["agente_comercial_ativo", "agente_comercial_ia", "agente_comercial_outras_origens"]),
        supabase
          .from("plataforma_textos")
          .select("chave, valor")
          .in("chave", ["agenda_demonstracao_url", "agente_comercial_assinatura", "comercial_email"]),
      ]);
      if (numeros.error) throw numeros.error;
      if (textos.error) throw textos.error;
      const n = (c: string) => Number(numeros.data?.find((l) => l.chave === c)?.valor ?? 0) === 1;
      const t = (c: string) => textos.data?.find((l) => l.chave === c)?.valor?.trim() || null;
      return {
        ativo: n("agente_comercial_ativo"),
        ia: n("agente_comercial_ia"),
        outrasOrigens: n("agente_comercial_outras_origens"),
        agenda: t("agenda_demonstracao_url"),
        assinatura: t("agente_comercial_assinatura"),
        responderPara: t("comercial_email"),
      };
    },
  });
}

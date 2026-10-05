import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// O medidor de uso das IAs: uma linha em `ia_chamadas` por chamada, com o
// resultado, os tokens e a latência. Nenhum texto entra aqui, nem a pergunta
// nem a resposta. O Sentinela segue congelado e não registra.
//
// "recusada_trava" é a resposta que o modelo deu e a nossa trava descartou:
// o espelho da Letícia com número ou promessa, o texto do assistente com
// número que não está na Central, a dieta com alimento que não está no PDF,
// o Vigia com resposta fora do catálogo ou o quadro que nem saiu por não
// passar na validação. É o número que diz se a trava está trabalhando demais.

export type AgenteIA = "leticia" | "assistente" | "dieta_pdf" | "vigia";
export type ResultadoIA = "ok" | "recusada_trava" | "indisponivel";

export type RegistroUsoIA = {
  agente: AgenteIA;
  modelo: string;
  resultado: ResultadoIA;
  organizationId?: string | null;
  tokensEntrada?: number | null;
  tokensSaida?: number | null;
  latenciaMs?: number | null;
};

/** Grava a chamada. Nunca lança: o medidor não pode derrubar quem chamou o modelo. */
export async function registrarUsoIA(admin: SupabaseClient, r: RegistroUsoIA): Promise<void> {
  try {
    const { error } = await admin.from("ia_chamadas").insert({
      agente: r.agente,
      modelo: r.modelo,
      resultado: r.resultado,
      organization_id: r.organizationId ?? null,
      tokens_entrada: r.tokensEntrada ?? null,
      tokens_saida: r.tokensSaida ?? null,
      latencia_ms: r.latenciaMs ?? null,
    });
    if (error) console.error("uso de IA não registrado", error.code);
  } catch {
    console.error("uso de IA não registrado", "falha de rede");
  }
}

import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chavePublicaVapid } from "./vapid.ts";
import { emLotes, inscricaoMorta, type OpcoesAviso } from "./avisoPush.ts";

// O envio de aviso no celular, igual para o chat, o comunicado e o resumo
// semanal. Antes, cada função mandava um aviso por vez, sem validade (o
// serviço de push guardava o aviso por quatro semanas) e sem agrupar: dez
// mensagens viravam dez avisos empilhados.
//
// Agora: lotes de 25 ao mesmo tempo, validade por tipo de aviso, tópico e
// etiqueta por conversa (avisoPush.ts), prazo de 10 s por envio e a
// inscrição morta apagada numa consulta só por lote.

export type Inscricao = { endpoint: string; p256dh: string; auth: string };
export type Aviso = { title: string; body: string; url: string; tag?: string | null };
export type ResultadoEnvio = { enviados: number; removidas: number; falhas: number };

const PRAZO_ENVIO_MS = 10_000;

export async function enviarAvisos(
  admin: SupabaseClient,
  inscricoes: Inscricao[],
  aviso: Aviso,
  opcoes: OpcoesAviso,
): Promise<ResultadoEnvio> {
  const resultado: ResultadoEnvio = { enviados: 0, removidas: 0, falhas: 0 };
  const privada = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!privada || inscricoes.length === 0) return resultado;
  webpush.setVapidDetails("mailto:noreply@arkefit.com.br", chavePublicaVapid(privada), privada);

  const carga = JSON.stringify({ title: aviso.title, body: aviso.body, url: aviso.url, ...(aviso.tag ? { tag: aviso.tag } : {}) });
  const detalhes = {
    TTL: opcoes.validadeSeg,
    urgency: opcoes.urgencia ?? "normal",
    timeout: PRAZO_ENVIO_MS,
    ...(opcoes.topico ? { topic: opcoes.topico } : {}),
  };

  for (const lote of emLotes(inscricoes)) {
    const envios = await Promise.allSettled(
      lote.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, detalhes)),
    );
    const mortas: string[] = [];
    envios.forEach((envio, i) => {
      if (envio.status === "fulfilled") {
        resultado.enviados++;
        return;
      }
      const e = envio.reason as { statusCode?: number; body?: unknown };
      if (inscricaoMorta(e.statusCode, typeof e.body === "string" ? e.body : undefined)) {
        mortas.push(lote[i].endpoint);
      } else {
        resultado.falhas++;
        // Só o status: o corpo da resposta pode ecoar o endereço da inscrição.
        console.error("push: envio falhou", e.statusCode ?? "sem status");
      }
    });
    if (mortas.length) {
      const { error } = await admin.from("push_subscriptions").delete().in("endpoint", mortas);
      if (error) console.error("push: inscrições mortas não apagadas", error.code);
      else resultado.removidas += mortas.length;
    }
  }
  return resultado;
}

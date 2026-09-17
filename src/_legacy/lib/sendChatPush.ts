import { supabase } from "@/integrations/supabase/client";

/**
 * Dispara push notification para um destinatário específico (ou para uma role)
 * após o envio de uma mensagem de chat. A função edge faz a whitelist de
 * quem realmente recebe (modo de teste). Falhas são silenciosas para não
 * bloquear o envio da mensagem.
 */
export async function sendChatPush(params: {
  recipientUserId?: string;
  recipientRole?: "admin" | "super_admin";
  title: string;
  body: string;
  url?: string;
}) {
  try {
    await supabase.functions.invoke("send-chat-push", { body: params });
  } catch (err) {
    console.warn("sendChatPush failed (ignored):", err);
  }
}

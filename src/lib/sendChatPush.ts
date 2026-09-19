import { supabase } from "@/integrations/supabase/client";

/**
 * Dispara push notification para um destinatário específico, ou para os
 * membros de uma organização com determinado(s) papel(is) (ex.: professor
 * da mesma academia do aluno) após o envio de uma mensagem de chat. A
 * função edge faz a whitelist de quem realmente recebe (modo de teste).
 * Falhas são silenciosas para não bloquear o envio da mensagem.
 */
export async function sendChatPush(params: {
  recipientUserId?: string;
  recipientOrgId?: string;
  recipientOrgRoles?: string[];
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

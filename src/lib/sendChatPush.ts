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
  /** `treino:<aluno>` ou `dieta:<dieta>`: os avisos da mesma conversa se agrupam no aparelho. */
  conversa?: string;
}) {
  try {
    await supabase.functions.invoke("send-chat-push", { body: params });
  } catch (err) {
    console.warn("sendChatPush failed (ignored):", err);
  }
}

/**
 * Aviso no celular da conversa com o mentor ARKE: só o aluno vai; o servidor
 * confere a mensagem recém-gravada e decide quem recebe e o texto, sem trecho
 * (send-chat-push/regras.ts). Falha silenciosa, como o de cima.
 */
export async function avisarConversaComMentor(alunoId: string) {
  try {
    await supabase.functions.invoke("send-chat-push", { body: { canal: "mentor", alunoId } });
  } catch (err) {
    console.warn("avisarConversaComMentor failed (ignored):", err);
  }
}

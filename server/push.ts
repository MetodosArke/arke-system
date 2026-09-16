import webpush from "web-push";
import { deletePushSubscription, getPushSubscriptionsForUser } from "./supabaseAdmin";

// Substitui a edge function Deno "send-chat-push" do arke-app original —
// mesma lógica (VAPID, resolução de assinaturas por user_id, limpeza de
// assinaturas expiradas), agora rodando no próprio servidor tRPC em vez de
// uma function separada invocada pelo cliente.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@arkefit.com.br";

export function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return pushConfigured() ? (VAPID_PUBLIC_KEY as string) : null;
}

if (pushConfigured()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY as string, VAPID_PRIVATE_KEY as string);
}

export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!pushConfigured()) return { sent: 0 };
  const subscriptions = await getPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return { sent: 0 };
  const payloadStr = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || "/" });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payloadStr);
      sent++;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) await deletePushSubscription(subscription.user_id, subscription.endpoint);
    }
  }
  return { sent };
}

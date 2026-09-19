import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TEMP: whitelist de emails que podem receber push de chat (em teste).
// Quando liberar para todos, deixar a lista vazia.
const PUSH_EMAIL_WHITELIST = new Set<string>([]);

interface Payload {
  recipientUserId?: string;
  // Em vez do "admin" global do app original (que não existe no sistema
  // multitenant), o chamador resolve o destinatário por papel *dentro da
  // organização* do aluno — ex.: professor/gestor da própria academia.
  recipientOrgId?: string;
  recipientOrgRoles?: string[];
  title: string;
  body: string;
  url?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPrivateKey) {
      return new Response(JSON.stringify({ skipped: true, reason: "no VAPID key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidPublicKey = deriveVapidPublicKey(vapidPrivateKey);
    webpush.setVapidDetails(
      "mailto:noreply@metodosarke.com.br",
      vapidPublicKey,
      vapidPrivateKey,
    );

    const body = (await req.json()) as Payload;
    const { recipientUserId, recipientOrgId, recipientOrgRoles, title, body: msgBody, url } = body || ({} as Payload);

    if ((!recipientUserId && !(recipientOrgId && recipientOrgRoles?.length)) || !title || !msgBody) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Resolver lista de user_ids destinatários
    let targetUserIds: string[] = [];
    if (recipientUserId) {
      targetUserIds = [recipientUserId];
    } else if (recipientOrgId && recipientOrgRoles?.length) {
      const { data: membros } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", recipientOrgId)
        .eq("status", "active")
        .in("role", recipientOrgRoles);
      targetUserIds = (membros || []).map((m: any) => m.user_id);
    }

    // Filtrar pela whitelist de email (modo teste).
    if (PUSH_EMAIL_WHITELIST.size > 0 && targetUserIds.length > 0) {
      const filtered: string[] = [];
      for (const uid of targetUserIds) {
        const { data: userInfo } = await supabase.auth.admin.getUserById(uid);
        const email = (userInfo?.user?.email || "").toLowerCase();
        if (PUSH_EMAIL_WHITELIST.has(email)) filtered.push(uid);
      }
      targetUserIds = filtered;
    }

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "no recipients after whitelist" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", targetUserIds);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    const payloadStr = JSON.stringify({ title, body: msgBody, url: url || "/" });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
        sent++;
      } catch (err: any) {
        const errBody = String(err.body || err.message || "");
        const shouldDelete =
          err.statusCode === 410 ||
          err.statusCode === 404 ||
          (err.statusCode === 403 && errBody.toLowerCase().includes("vapid credentials"));
        console.error(`Push failed (${err.statusCode}):`, errBody);
        if (shouldDelete) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint)
            .eq("user_id", sub.user_id);
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("send-chat-push error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function deriveVapidPublicKey(privateKey: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(base64UrlToBuffer(privateKey));
  return toBase64Url(ecdh.getPublicKey(undefined, "uncompressed"));
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

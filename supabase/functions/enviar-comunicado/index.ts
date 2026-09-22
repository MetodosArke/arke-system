import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Publico = "alunos" | "equipe" | "todos";

// Comunicado em massa da academia: grava o aviso (que aparece no app) e manda
// notificação no celular de quem ativou. Gestor ou recepção da organização.
// A publicação vale mesmo se a notificação falhar — o aviso está no app.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);

  try {
    const { organization_id: organizationId, titulo, mensagem, publico, expira_em: expiraEm } = (await req.json()) as {
      organization_id?: string;
      titulo?: string;
      mensagem?: string;
      publico?: Publico;
      expira_em?: string | null;
    };
    if (!organizationId || !titulo?.trim() || !mensagem?.trim() || !["alunos", "equipe", "todos"].includes(publico ?? "")) {
      return jsonResponse({ error: "Preencha título, mensagem e público." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    // Grava como o próprio chamador: as regras da tabela conferem que ele é
    // gestor ou recepção DESTA organização.
    const { data: comunicado, error: erroInsert } = await asUser
      .from("comunicados")
      .insert({
        organization_id: organizationId,
        titulo: titulo.trim(),
        mensagem: mensagem.trim(),
        publico,
        expira_em: expiraEm || null,
        criado_por: callerId,
      })
      .select("id")
      .single();
    if (erroInsert || !comunicado) {
      return jsonResponse({ error: "Só o gestor ou a recepção publicam comunicados desta academia." }, 403);
    }

    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPrivateKey) return jsonResponse({ ok: true, enviados: 0 });

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const papeis = publico === "alunos" ? ["aluno"] : publico === "equipe" ? ["gestor", "professor", "nutricionista", "recepcao"] : null;
    let consulta = admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("status", "active");
    if (papeis) consulta = consulta.in("role", papeis);
    const { data: membros } = await consulta;
    const destinatarios = [...new Set((membros ?? []).map((m) => m.user_id).filter((u) => u !== callerId))];
    if (!destinatarios.length) return jsonResponse({ ok: true, enviados: 0 });

    // Alunos pausados ou inadimplentes não estão no app: não recebem aviso de uso.
    let alvo = destinatarios;
    if (publico !== "equipe") {
      const { data: foraDoApp } = await admin
        .from("alunos")
        .select("user_id")
        .eq("organization_id", organizationId)
        .neq("situacao_academia", "em_dia");
      const fora = new Set((foraDoApp ?? []).map((a) => a.user_id));
      alvo = destinatarios.filter((u) => !fora.has(u));
    }

    const { data: inscricoes } = await admin.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", alvo);
    if (!inscricoes?.length) return jsonResponse({ ok: true, enviados: 0 });

    webpush.setVapidDetails("mailto:noreply@arkefit.com.br", chavePublica(vapidPrivateKey), vapidPrivateKey);
    const carga = JSON.stringify({ title: titulo.trim(), body: mensagem.trim().slice(0, 180), url: publico === "equipe" ? "/#/admin" : "/#/app" });

    let enviados = 0;
    for (const s of inscricoes) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga);
        enviados++;
      } catch (err) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 404 || e.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint).eq("user_id", s.user_id);
        } else {
          console.error("enviar-comunicado: push falhou", e.statusCode);
        }
      }
    }
    return jsonResponse({ ok: true, enviados });
  } catch (erro) {
    console.error("enviar-comunicado: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

function chavePublica(privada: string): string {
  const ecdh = createECDH("prime256v1");
  const normalizada = privada.replace(/-/g, "+").replace(/_/g, "/");
  ecdh.setPrivateKey(Buffer.from(normalizada + "=".repeat((4 - (normalizada.length % 4)) % 4), "base64"));
  return Buffer.from(ecdh.getPublicKey(undefined, "uncompressed")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

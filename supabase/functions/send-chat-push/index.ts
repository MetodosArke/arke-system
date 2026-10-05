import { createClient } from "npm:@supabase/supabase-js@2";
import { agrupamentoDaConversa, VALIDADE_SEG } from "../_shared/avisoPush.ts";
import { enviarAvisos } from "../_shared/push.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { caminhoDoApp, papeisDaEquipe, podeAvisarPessoa, TEXTO_MAXIMO, textoDoAviso, TITULO_MAXIMO } from "./regras.ts";
import { servir } from "../_shared/servir.ts";

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
  /** `treino:<aluno>` ou `dieta:<dieta>`: agrupa os avisos da mesma conversa no aparelho. */
  conversa?: string;
}

servir("send-chat-push", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Sem isto, qualquer pessoa na internet (sem sessão nenhuma) conseguia
  // mandar push com título/corpo/url arbitrários pra qualquer usuário ou
  // pra toda a equipe de qualquer organização — relay de phishing/spam
  // aberto, e um jeito grátis de gerar custo de envio no VAPID/web-push.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Sessão inválida. Faça login novamente." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPrivateKey) {
      return new Response(JSON.stringify({ skipped: true, reason: "no VAPID key" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Payload;
    const { recipientUserId, recipientOrgId, recipientOrgRoles } = body || ({} as Payload);
    const title = textoDoAviso(body?.title, TITULO_MAXIMO);
    const msgBody = textoDoAviso(body?.body, TEXTO_MAXIMO);
    const url = caminhoDoApp(body?.url);

    if ((!recipientUserId && !(recipientOrgId && recipientOrgRoles?.length)) || !title || !msgBody) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return new Response(JSON.stringify({ error: "Sessão inválida. Faça login novamente." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Uma mensagem de chat gera um aviso; um laço, centenas.
    if (!(await dentroDoFreio(supabase, [{ chave: `push:user:${callerId}`, limite: 60, janelaSeg: 10 * 60 }]))) {
      return new Response(JSON.stringify({ error: MENSAGEM_FREIO }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Quem manda o push precisa pertencer à MESMA organização do(s)
    // destinatário(s) — mensagens de chat são sempre dentro de uma
    // organização (aluno <-> staff da própria academia). E o papel conta:
    // o aluno só avisa a equipe, nunca outro aluno (regras.ts).
    const { data: callerOrgs } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", callerId)
      .eq("status", "active");
    const papelNa = new Map<string, string>((callerOrgs ?? []).map((m) => [m.organization_id, m.role]));

    let orgAutorizada: string | null = null;
    let targetUserIds: string[] = [];
    if (recipientOrgId) {
      const papeis = papeisDaEquipe(recipientOrgRoles);
      if (papelNa.has(recipientOrgId) && papeis.length > 0) {
        orgAutorizada = recipientOrgId;
        const { data: membros } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", recipientOrgId)
          .eq("status", "active")
          .in("role", papeis);
        targetUserIds = (membros || []).map((m: { user_id: string }) => m.user_id);
      }
    } else if (recipientUserId) {
      // O destinatário pode ter vínculo ativo em mais de uma academia, e
      // com .maybeSingle() a consulta falhava — a notificação simplesmente
      // não saía. Buscar a lista e cruzar com as organizações do remetente
      // não só conserta como responde melhor à pergunta real: qual é a
      // academia que os dois têm em comum.
      const { data: vinculosAlvo } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", recipientUserId)
        .eq("status", "active");
      orgAutorizada =
        (vinculosAlvo ?? []).find((v) => podeAvisarPessoa(papelNa.get(v.organization_id) ?? null, v.role))
          ?.organization_id ?? null;
      if (orgAutorizada) targetUserIds = [recipientUserId];
    }
    if (!orgAutorizada) {
      return new Response(JSON.stringify({ error: "Você não tem permissão para notificar este destinatário." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const { data: subscriptions, error: erroInscricoes } = await supabase
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", targetUserIds);
    if (erroInscricoes) {
      console.error("send-chat-push: inscrições indisponíveis", erroInscricoes.code);
      return new Response(JSON.stringify({ error: "Não foi possível avisar agora." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mesma conversa, mesmo grupo: no aparelho o aviso novo substitui o
    // anterior, e com o aparelho desligado só o último fica guardado.
    const grupo = agrupamentoDaConversa(body?.conversa);
    const { enviados: sent } = await enviarAvisos(
      supabase,
      subscriptions,
      { title, body: msgBody, url, tag: grupo?.etiqueta },
      { validadeSeg: VALIDADE_SEG.chat, topico: grupo?.topico, urgencia: "high" },
    );

    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // Só o tipo vai para o log, e a resposta não ecoa a mensagem do erro.
    console.error("send-chat-push: erro inesperado", error instanceof Error ? error.name : typeof error);
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

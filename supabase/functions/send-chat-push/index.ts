import { createClient } from "npm:@supabase/supabase-js@2";
import { agrupamentoDaConversa, VALIDADE_SEG } from "../_shared/avisoPush.ts";
import { enviarAvisos } from "../_shared/push.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import {
  AVISO_DO_MENTOR,
  caminhoDoApp,
  destinoNoCanalMentor,
  mensagemRecente,
  papeisDaEquipe,
  podeAvisarPessoa,
  TEXTO_MAXIMO,
  textoDoAviso,
  TITULO_MAXIMO,
} from "./regras.ts";
import { servir } from "../_shared/servir.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

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
  /**
   * `mentor`: a conversa do aluno do Método com o mentor da ArkeFit. Só vai o
   * `alunoId`; o servidor decide o resto (avisarCanalMentor).
   */
  canal?: "mentor";
  alunoId?: string;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * O aviso da conversa com o mentor (10/10/2026). A prova de que quem chama
 * fala nessa conversa é a mensagem que ele acabou de gravar, lida com o RLS
 * dele: `mensagens_mentor` só deixa o próprio aluno e a equipe da Mentoria
 * (com as duas etapas, e o Mentor só com o aluno do Método) ler e escrever.
 */
async function avisarCanalMentor(
  asUser: SupabaseClient,
  supabase: SupabaseClient,
  callerId: string,
  alunoId: unknown,
): Promise<Response> {
  if (typeof alunoId !== "string" || !/^[0-9a-f-]{36}$/i.test(alunoId)) return json({ error: "missing fields" }, 400);

  const { data: ultima, error: erroUltima } = await asUser
    .from("mensagens_mentor")
    .select("remetente_tipo, created_at")
    .eq("aluno_id", alunoId)
    .eq("remetente_id", callerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroUltima) {
    console.error("send-chat-push: conversa do mentor indisponível", erroUltima.code);
    return json({ error: "Não foi possível avisar agora." }, 502);
  }
  if (!ultima || !mensagemRecente(ultima.created_at)) {
    return json({ error: "Você não tem permissão para notificar este destinatário." }, 403);
  }

  const [aluno, noMetodo, socios, mentores] = await Promise.all([
    supabase.from("alunos").select("user_id, mentor_id").eq("id", alunoId).maybeSingle(),
    supabase.rpc("aluno_no_metodo", { _aluno_id: alunoId }),
    supabase.from("user_roles").select("user_id").eq("role", "superadmin"),
    supabase.from("equipe_arkefit").select("user_id").eq("ativo", true).contains("niveis", ["mentor"]),
  ]);
  const erro = aluno.error ?? noMetodo.error ?? socios.error ?? mentores.error;
  if (erro || !aluno.data) {
    console.error("send-chat-push: canal do mentor sem dados", erro?.code ?? "sem aluno");
    return json({ error: "Não foi possível avisar agora." }, 502);
  }

  const equipe = [...(socios.data ?? []), ...(mentores.data ?? [])].map((r: { user_id: string }) => r.user_id);
  const destino = destinoNoCanalMentor(ultima.remetente_tipo, aluno.data, equipe, noMetodo.data === true)
    .filter((id) => id !== callerId);
  if (destino.length === 0) return json({ skipped: true, reason: "no recipients" });

  const { data: inscricoes, error: erroInscricoes } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", destino);
  if (erroInscricoes) {
    console.error("send-chat-push: inscrições indisponíveis", erroInscricoes.code);
    return json({ error: "Não foi possível avisar agora." }, 502);
  }
  if (!inscricoes?.length) return json({ sent: 0, reason: "no subscriptions" });

  const aviso = ultima.remetente_tipo === "mentor" ? AVISO_DO_MENTOR.paraAluno : AVISO_DO_MENTOR.paraMentor;
  const grupo = agrupamentoDaConversa(`mentor:${alunoId}`);
  const { enviados } = await enviarAvisos(
    supabase,
    inscricoes,
    { ...aviso, tag: grupo?.etiqueta },
    { validadeSeg: VALIDADE_SEG.chat, topico: grupo?.topico, urgencia: "high" },
  );
  return json({ success: true, sent: enviados });
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

    const canalMentor = body?.canal === "mentor";
    if (!canalMentor && ((!recipientUserId && !(recipientOrgId && recipientOrgRoles?.length)) || !title || !msgBody)) {
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

    if (canalMentor) return await avisarCanalMentor(asUser, supabase, callerId, body?.alunoId);

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

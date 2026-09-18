import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type ImpersonarPayload = {
  user_id: string;
};

// Gera um token de sessão (magic link) para o admin_arke/gestor "simular"
// outro perfil já cadastrado, para testes de homologação — nunca expõe ou
// altera a senha do usuário simulado. O frontend troca esse token pela
// sessão do usuário-alvo via supabase.auth.verifyOtp, depois de guardar a
// própria sessão do admin para poder voltar.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<ImpersonarPayload> = await req.json();
    const targetUserId = payload.user_id;
    if (!targetUserId) {
      return jsonResponse({ error: "user_id é obrigatório." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }
    if (callerId === targetUserId) {
      return jsonResponse({ error: "Você já está autenticado como este usuário." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsAdminArke = (callerRoles ?? []).some((r) => r.role === "admin_arke");
    const callerIsSuperadmin = (callerRoles ?? []).some((r) => r.role === "superadmin");

    const { data: targetMembership, error: targetMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", targetUserId)
      .eq("status", "active")
      .maybeSingle();
    if (targetMembershipError) {
      console.error("Error loading target membership", targetMembershipError);
      return jsonResponse({ error: "Erro ao validar o perfil de destino." }, 500);
    }
    if (!targetMembership) {
      return jsonResponse({ error: "Perfil de destino não encontrado ou sem organização ativa." }, 404);
    }

    let autorizado = callerIsAdminArke || callerIsSuperadmin;
    if (!autorizado) {
      const { data: callerMembership, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle();
      if (callerMembershipError) {
        console.error("Error loading caller membership", callerMembershipError);
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      autorizado =
        callerMembership?.role === "gestor" &&
        callerMembership.organization_id === targetMembership.organization_id;
    }

    if (!autorizado) {
      return jsonResponse({ error: "Você não tem permissão para simular este perfil." }, 403);
    }

    const { data: targetUser, error: targetUserError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (targetUserError || !targetUser.user?.email) {
      console.error("Error loading target user", targetUserError);
      return jsonResponse({ error: "Usuário de destino não encontrado." }, 404);
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.user.email,
    });
    if (linkError || !linkData) {
      console.error("Error generating impersonation link", linkError);
      return jsonResponse({ error: "Erro ao gerar acesso de simulação." }, 500);
    }

    return jsonResponse({
      email: targetUser.user.email,
      token_hash: linkData.properties.hashed_token,
    });
  } catch (error) {
    console.error("Unexpected error in impersonar-perfil", error);
    return jsonResponse({ error: "Erro inesperado ao simular o perfil." }, 500);
  }
});

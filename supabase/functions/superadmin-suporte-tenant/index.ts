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

type Acao = "resetar_token_gateway" | "alterar_email_gestor";
const ACOES_VALIDAS = new Set<Acao>(["resetar_token_gateway", "alterar_email_gestor"]);

type SuportePayload = {
  organization_id: string;
  acao: Acao;
  novo_email?: string; // obrigatório quando acao === "alterar_email_gestor"
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ações de suporte do SuperAdmin sobre um tenant específico: resetar o(s)
// token(s) de dispositivo do Gateway Local (organizacao_catracas.device_token)
// e trocar o e-mail de login do gestor principal (auth.users — por isso
// exige Admin API/service_role, não dá para fazer via update direto do
// client). As duas ficam na mesma função por reaproveitar a mesma
// checagem de autorização (superadmin).
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
    const payload: Partial<SuportePayload> = await req.json();
    const organizationId = payload.organization_id?.trim();
    const acao = payload.acao;
    const novoEmail = payload.novo_email?.trim().toLowerCase();

    if (!organizationId) return jsonResponse({ error: "organization_id é obrigatório." }, 400);
    if (!acao || !ACOES_VALIDAS.has(acao)) {
      return jsonResponse({ error: "Ação inválida." }, 400);
    }
    if (acao === "alterar_email_gestor" && (!novoEmail || !EMAIL_RE.test(novoEmail))) {
      return jsonResponse({ error: "Novo e-mail do gestor inválido." }, 400);
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsSuperadmin = (callerRoles ?? []).some((r) => r.role === "superadmin");
    if (!callerIsSuperadmin) {
      return jsonResponse({ error: "Apenas o Super Admin ArkeFit pode executar ações de suporte." }, 403);
    }

    if (acao === "resetar_token_gateway") {
      const { data: qtd, error: resetError } = await adminClient.rpc("superadmin_resetar_tokens_gateway", {
        _organization_id: organizationId,
      });
      if (resetError) {
        console.error("Error resetting gateway tokens", resetError);
        return jsonResponse({ error: "Erro ao resetar o token do gateway." }, 500);
      }
      return jsonResponse({ success: true, catracas_resetadas: qtd ?? 0 });
    }

    // alterar_email_gestor
    const { data: gestorMembership, error: gestorError } = await adminClient
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "gestor")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (gestorError) {
      console.error("Error loading gestor", gestorError);
      return jsonResponse({ error: "Erro ao localizar o gestor da organização." }, 500);
    }
    if (!gestorMembership) {
      return jsonResponse({ error: "Nenhum gestor ativo encontrado nesta organização." }, 404);
    }

    const { error: emailError } = await adminClient.auth.admin.updateUserById(gestorMembership.user_id, {
      email: novoEmail,
      email_confirm: true,
    });
    if (emailError) {
      console.error("Error updating gestor email", emailError);
      const jaExiste = emailError.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        { error: jaExiste ? "Já existe um usuário cadastrado com esse e-mail." : emailError.message },
        jaExiste ? 409 : 400
      );
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in superadmin-suporte-tenant", error);
    return jsonResponse({ error: "Erro inesperado ao executar a ação de suporte." }, 500);
  }
});

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

type Papel = "gestor" | "professor" | "nutricionista" | "recepcao";
const PAPEIS_VALIDOS = new Set<Papel>(["gestor", "professor", "nutricionista", "recepcao"]);

type EditarMembroPayload = {
  user_id: string;
  organization_id: string;
  full_name?: string;
  email?: string;
  role?: Papel;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Edita nome, e-mail e/ou papel de um membro de equipe já cadastrado.
// E-mail vive em auth.users (não em profiles), então essa troca exige a
// Admin API com service_role — por isso é uma Edge Function, não um
// update direto do client. Nome e papel também passam por aqui para
// manter a mesma checagem de autorização (gestor da própria org, ou
// admin_arke) num só lugar.
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
    const payload: Partial<EditarMembroPayload> = await req.json();
    const targetUserId = payload.user_id?.trim();
    const organizationId = payload.organization_id?.trim();
    const fullName = payload.full_name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const role = payload.role;

    if (!targetUserId) {
      return jsonResponse({ error: "user_id é obrigatório." }, 400);
    }
    if (!organizationId) {
      return jsonResponse({ error: "organization_id é obrigatório." }, 400);
    }
    if (email && !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (role && !PAPEIS_VALIDOS.has(role)) {
      return jsonResponse({ error: "Papel inválido. Use gestor, professor, nutricionista ou recepcao." }, 400);
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
    const callerIsAdminArke = (callerRoles ?? []).some((r) => r.role === "admin_arke");

    // Um mesmo user_id pode ter vínculos ativos em mais de uma organização
    // (ex.: personal que também atende como recepção em outra unidade) —
    // por isso a busca do membro-alvo é sempre escopada por organization_id
    // (enviado pelo client, que já opera dentro de uma organização), nunca
    // só por user_id+status (isso quebrava com "cannot coerce ... single
    // JSON object" quando havia mais de uma linha ativa).
    let autorizado = callerIsAdminArke;
    if (!autorizado) {
      const { data: callerMembership, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", callerId)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle();
      if (callerMembershipError) {
        console.error("Error loading caller membership", callerMembershipError);
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      autorizado = callerMembership?.role === "gestor";
    }
    if (!autorizado) {
      return jsonResponse({ error: "Apenas o gestor da organização pode editar membros da equipe." }, 403);
    }

    const { data: targetMembership, error: targetMembershipError } = await adminClient
      .from("organization_members")
      .select("id, organization_id, role")
      .eq("user_id", targetUserId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (targetMembershipError) {
      console.error("Error loading target membership", targetMembershipError);
      return jsonResponse({ error: "Erro ao validar o membro." }, 500);
    }
    if (!targetMembership) {
      return jsonResponse({ error: "Membro não encontrado nesta organização." }, 404);
    }

    if (email) {
      const { error: emailError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        email,
        email_confirm: true,
      });
      if (emailError) {
        console.error("Error updating email", emailError);
        const jaExiste = emailError.message?.toLowerCase().includes("already been registered");
        return jsonResponse(
          { error: jaExiste ? "Já existe um usuário cadastrado com esse e-mail." : emailError.message },
          jaExiste ? 409 : 400
        );
      }
    }

    if (fullName) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ full_name: fullName })
        .eq("user_id", targetUserId);
      if (profileError) {
        console.error("Error updating profile", profileError);
        return jsonResponse({ error: "Erro ao atualizar o nome." }, 500);
      }
    }

    if (role) {
      const { error: roleError } = await adminClient
        .from("organization_members")
        .update({ role })
        .eq("id", targetMembership.id);
      if (roleError) {
        console.error("Error updating role", roleError);
        return jsonResponse({ error: "Erro ao atualizar o papel." }, 500);
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in editar-membro-equipe", error);
    return jsonResponse({ error: "Erro inesperado ao editar o membro." }, 500);
  }
});

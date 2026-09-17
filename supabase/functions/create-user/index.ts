import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type CreateUserPayload = {
  email: string;
  full_name: string;
  role: "aluno" | "admin" | "professor";
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
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

    let payload: Partial<CreateUserPayload>;
    try {
      payload = await req.json();
    } catch (parseError) {
      console.error("Invalid request body", parseError);
      return jsonResponse({ error: "Payload inválido." }, 400);
    }

    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.full_name?.trim();
    const role = payload.role;

    if (!email || !fullName || !role) {
      return jsonResponse({ error: "Missing required fields: email, full_name, role" }, 400);
    }

    const validRoles = new Set<CreateUserPayload["role"]>(["aluno", "admin", "professor"]);
    if (!validRoles.has(role)) {
      return jsonResponse({ error: "Invalid role" }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

    if (claimsError || !callerId) {
      console.error("Failed to validate caller token", claimsError);
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRows, error: roleLookupError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin"])
      .limit(1);

    if (roleLookupError) {
      console.error("Failed to validate caller role", roleLookupError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }

    if (!roleRows?.length) {
      return jsonResponse({ error: "Forbidden: admin only" }, 403);
    }

    const tempPassword = `${crypto.randomUUID()}Aa1!`;
    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !createdUser.user) {
      console.error("Error creating auth user", createError);
      const alreadyExists = createError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        { error: createError?.message ?? "Failed to create user" },
        alreadyExists ? 409 : 400,
      );
    }

    const newUserId = createdUser.user.id;

    const { error: clearRolesError } = await adminClient
      .from("user_roles")
      .delete()
      .eq("user_id", newUserId);

    if (clearRolesError) {
      console.error("Error clearing existing roles", clearRolesError);
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: "Erro ao configurar o tipo do usuário." }, 500);
    }

    const { error: insertRoleError } = await adminClient
      .from("user_roles")
      .insert({ user_id: newUserId, role });

    if (insertRoleError) {
      console.error("Error inserting user role", insertRoleError);
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: insertRoleError.message ?? "Failed to set user role" }, 500);
    }

    const { data: profileRows, error: profileLookupError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("user_id", newUserId)
      .limit(1);

    if (profileLookupError) {
      console.error("Error loading profile after auth user creation", profileLookupError);
      await adminClient.from("user_roles").delete().eq("user_id", newUserId);
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const profileMutation = profileRows?.length
      ? adminClient
          .from("profiles")
          .update({ full_name: fullName, status: "active" })
          .eq("user_id", newUserId)
      : adminClient.from("profiles").insert({
          user_id: newUserId,
          full_name: fullName,
          status: "active",
        });

    const { error: profileMutationError } = await profileMutation;
    if (profileMutationError) {
      console.error("Error upserting profile", profileMutationError);
      await adminClient.from("user_roles").delete().eq("user_id", newUserId);
      await adminClient.auth.admin.deleteUser(newUserId);
      return jsonResponse({ error: "Erro ao salvar o perfil do usuário." }, 500);
    }

    const origin = req.headers.get("origin") || supabaseUrl;
    const resetClient = createClient(supabaseUrl, anonKey);
    const { error: resetError } = await resetClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/#/auth/reset-password`,
    });

    if (resetError) {
      console.error("Error sending reset email", resetError);
    }

    return jsonResponse({
      success: true,
      user_id: newUserId,
      email_sent: !resetError,
    });
  } catch (error) {
    console.error("Unhandled create-user error", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});

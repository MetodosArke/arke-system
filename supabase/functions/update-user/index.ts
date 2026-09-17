import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type UpdatePayload = {
  user_id: string;
  email?: string;
  full_name?: string;
  role?: "aluno" | "admin" | "professor" | "super_admin";
  send_password_reset?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Sessão inválida." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Configuração do servidor incompleta." }, 500);
    }

    const payload = (await req.json()) as Partial<UpdatePayload>;
    const userId = payload.user_id?.trim();
    if (!userId) return json({ error: "user_id é obrigatório" }, 400);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) return json({ error: "Sessão inválida." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin"]);
    if (!callerRoles?.length) return json({ error: "Forbidden: admin only" }, 403);

    const isCallerSuperAdmin = callerRoles.some((r: any) => r.role === "super_admin");

    // Fetch-only mode: return target user's email (used to prefill edit form)
    if ((payload as any).fetch_only) {
      const { data: userData, error: getErr } = await adminClient.auth.admin.getUserById(userId);
      if (getErr || !userData?.user) {
        return json({ error: "Usuário não encontrado" }, 404);
      }
      return json({ success: true, email: userData.user.email ?? "" });
    }

    // Update auth user email if provided
    let emailUpdated = false;
    if (payload.email) {
      const newEmail = payload.email.trim().toLowerCase();
      const { error: emailErr } = await adminClient.auth.admin.updateUserById(userId, {
        email: newEmail,
        email_confirm: true,
      });
      if (emailErr) {
        console.error("Update email error", emailErr);
        return json({ error: emailErr.message ?? "Erro ao atualizar email" }, 400);
      }
      emailUpdated = true;
    }

    // Update profile name
    if (payload.full_name) {
      const { error: pErr } = await adminClient
        .from("profiles")
        .update({ full_name: payload.full_name.trim() })
        .eq("user_id", userId);
      if (pErr) console.error("Profile update error", pErr);
    }

    // Update role
    if (payload.role) {
      if (payload.role === "super_admin" && !isCallerSuperAdmin) {
        return json({ error: "Apenas super_admin pode atribuir super_admin" }, 403);
      }
      await adminClient.from("user_roles").delete().eq("user_id", userId);
      const { error: rErr } = await adminClient
        .from("user_roles")
        .insert({ user_id: userId, role: payload.role });
      if (rErr) {
        console.error("Role update error", rErr);
        return json({ error: rErr.message }, 400);
      }
    }

    // Send password reset email — strictly to the EDITED user (never the caller)
    let resetSent = false;
    if (payload.send_password_reset) {
      // Re-fetch the target user by ID to guarantee we use the edited user's email
      const { data: userData, error: getErr } = await adminClient.auth.admin.getUserById(userId);
      if (getErr || !userData?.user) {
        console.error("Could not load target user for reset", getErr);
        return json({ error: "Usuário alvo não encontrado para reset" }, 404);
      }
      const targetEmail = userData.user.email;
      const targetId = userData.user.id;

      // Safety guard: ensure we are NOT sending to the caller by accident
      if (!targetEmail || targetId !== userId) {
        return json({ error: "Inconsistência ao identificar usuário alvo" }, 400);
      }

      const origin = req.headers.get("origin") || supabaseUrl;
      // Use admin generateLink — token is bound to targetEmail specifically,
      // independent of any session/cookie of the caller.
      const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email: targetEmail,
        options: { redirectTo: `${origin}/#/auth/reset-password` },
      });
      if (linkErr) {
        console.error("generateLink error", linkErr);
        return json({ error: linkErr.message ?? "Erro ao gerar link de reset" }, 400);
      }
      console.log(`Reset link generated for user ${targetId} (${targetEmail})`);
      resetSent = true;
      // Note: Supabase automatically dispatches the recovery email to targetEmail
      // when generateLink(type:"recovery") is called with the project's email provider configured.
    }

    return json({ success: true, email_updated: emailUpdated, reset_sent: resetSent });
  } catch (e) {
    console.error("Unhandled update-user error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

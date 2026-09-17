import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
      return jsonResponse({ error: "Sessão inválida." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
    }

    let payload: { user_id?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Payload inválido." }, 400);
    }

    const targetUserId = payload.user_id?.trim();
    if (!targetUserId) {
      return jsonResponse({ error: "user_id é obrigatório." }, 400);
    }

    // Validate caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRows, error: roleLookupError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .in("role", ["admin", "super_admin"])
      .limit(1);

    if (roleLookupError || !roleRows?.length) {
      return jsonResponse({ error: "Forbidden: admin only" }, 403);
    }

    // Prevent self-deletion
    if (targetUserId === callerId) {
      return jsonResponse({ error: "Você não pode excluir a si mesmo." }, 400);
    }

    // Delete related data in order (child tables first)
    const tablesToClean = [
      { table: "registro_serie", via: "registro_treino", column: "aluno_id" },
      { table: "registro_treino", column: "aluno_id" },
      { table: "treino_exercicios", via: "treinos", column: "aluno_id" },
      { table: "treinos", column: "aluno_id" },
      { table: "dieta_adesao", column: "aluno_id" },
      { table: "mensagens_dieta", column: "aluno_id" },
      { table: "dietas", column: "aluno_id" },
      { table: "mensagens_treino", column: "aluno_id" },
      { table: "treino_calendario", column: "aluno_id" },
      { table: "progresso_semanal", column: "aluno_id" },
      { table: "metricas_customizadas", column: "aluno_id" },
      { table: "desafio_progresso", column: "aluno_id" },
      { table: "desafio_participantes", column: "aluno_id" },
      { table: "prontuario_observacoes", column: "aluno_id" },
      { table: "checkin_diario", column: "user_id" },
      { table: "avaliacao_semanal", column: "user_id" },
      { table: "aluno_perfil", column: "user_id" },
      { table: "aluno_objetivos", column: "user_id" },
      { table: "aluno_valores", column: "user_id" },
      { table: "compromisso_semanal", column: "user_id" },
      { table: "rotina_semanal", column: "user_id" },
      { table: "plano_treino_semanal", column: "user_id" },
      { table: "notificacoes", column: "user_id" },
      { table: "feed_comments", column: "user_id" },
      { table: "feed_likes", column: "user_id" },
      { table: "feed_posts", column: "user_id" },
      { table: "profiles", column: "user_id" },
      { table: "user_roles", column: "user_id" },
    ];

    // Handle registro_serie (needs join through registro_treino)
    const { data: registroIds } = await adminClient
      .from("registro_treino")
      .select("id")
      .eq("aluno_id", targetUserId);
    
    if (registroIds?.length) {
      await adminClient
        .from("registro_serie")
        .delete()
        .in("registro_treino_id", registroIds.map(r => r.id));
    }

    // Handle treino_exercicios (needs join through treinos)
    const { data: treinoIds } = await adminClient
      .from("treinos")
      .select("id")
      .eq("aluno_id", targetUserId);
    
    if (treinoIds?.length) {
      await adminClient
        .from("treino_exercicios")
        .delete()
        .in("treino_id", treinoIds.map(t => t.id));
    }

    // Handle metrica_valores (needs join through progresso_semanal)
    const { data: progressoIds } = await adminClient
      .from("progresso_semanal")
      .select("id")
      .eq("aluno_id", targetUserId);
    
    if (progressoIds?.length) {
      await adminClient
        .from("metrica_valores")
        .delete()
        .in("progresso_id", progressoIds.map(p => p.id));
    }

    // Handle compromisso_metas (needs join through compromisso_semanal)
    const { data: compromissoIds } = await adminClient
      .from("compromisso_semanal")
      .select("id")
      .eq("user_id", targetUserId);
    
    if (compromissoIds?.length) {
      await adminClient
        .from("compromisso_metas")
        .delete()
        .in("compromisso_id", compromissoIds.map(c => c.id));
    }

    // Delete direct tables
    for (const item of tablesToClean) {
      if (item.via) continue; // Already handled above
      const { error: delError } = await adminClient
        .from(item.table)
        .delete()
        .eq(item.column, targetUserId);
      
      if (delError) {
        console.error(`Error deleting from ${item.table}:`, delError.message);
      }
    }

    // Finally delete auth user
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (authDeleteError) {
      console.error("Error deleting auth user:", authDeleteError.message);
      return jsonResponse({ error: "Erro ao excluir usuário da autenticação: " + authDeleteError.message }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unhandled delete-user error", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});

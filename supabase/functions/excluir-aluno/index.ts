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

type ExcluirPayload = {
  aluno_id: string;
};

// Exclusão DEFINITIVA de um aluno (diferente de anonimizar-aluno, que é o
// protocolo LGPD oficial e preserva o histórico financeiro). Esta função
// serve para limpar contas de teste/homologação: apaga o usuário no Auth,
// o que em cascata (ON DELETE CASCADE) remove alunos, organization_members,
// profiles, user_roles, links_ativacao e todos os dados vinculados ao
// aluno (treinos, dietas, checkins, avaliações, assinaturas, pagamentos
// etc.) — não deixa rastro nenhum, inclusive o e-mail fica livre para
// recadastro imediato.
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
    const payload: Partial<ExcluirPayload> = await req.json();
    const alunoId = payload.aluno_id?.trim();
    if (!alunoId) {
      return jsonResponse({ error: "aluno_id é obrigatório." }, 400);
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

    const { data: aluno, error: alunoError } = await adminClient
      .from("alunos")
      .select("id, user_id, organization_id")
      .eq("id", alunoId)
      .maybeSingle();
    if (alunoError) {
      console.error("Error loading aluno", alunoError);
      return jsonResponse({ error: "Erro ao carregar o aluno." }, 500);
    }
    if (!aluno) {
      return jsonResponse({ error: "Aluno não encontrado." }, 404);
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsAdminArke = (callerRoles ?? []).some((r) => r.role === "admin_arke");

    let autorizado = callerIsAdminArke;
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
      autorizado = callerMembership?.role === "gestor" && callerMembership.organization_id === aluno.organization_id;
    }
    if (!autorizado) {
      return jsonResponse({ error: "Apenas o gestor da organização pode excluir um aluno." }, 403);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(aluno.user_id);
    if (deleteError) {
      console.error("Error deleting aluno auth user", deleteError);
      return jsonResponse({ error: "Erro ao excluir o aluno." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in excluir-aluno", error);
    return jsonResponse({ error: "Erro inesperado ao excluir o aluno." }, 500);
  }
});

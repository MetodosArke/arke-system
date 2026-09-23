import { createClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { encerrarCobrancasDoAluno } from "../_shared/encerrarCobrancas.ts";

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

type AnonimizarPayload = {
  aluno_id: string;
};

// Política de Exclusão e Anonimização LGPD (soft delete): nunca apaga o
// registro do aluno nem seus dados financeiros (aluno_assinaturas,
// pagamentos, IDs do Asaas) — que precisam sobreviver para auditoria
// fiscal/contábil. Em vez disso, substitui os dados pessoais por
// placeholders e desativa o acesso do aluno à organização.
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
    const payload: Partial<AnonimizarPayload> = await req.json();
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
      .select("id, user_id, organization_id, anonimizado_em")
      .eq("id", alunoId)
      .maybeSingle();
    if (alunoError) {
      console.error("Error loading aluno", alunoError);
      return jsonResponse({ error: "Erro ao carregar o aluno." }, 500);
    }
    if (!aluno) {
      return jsonResponse({ error: "Aluno não encontrado." }, 404);
    }
    if (aluno.anonimizado_em) {
      return jsonResponse({ error: "Este aluno já foi anonimizado." }, 409);
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
      // Pergunta direta: o chamador é gestor DESTA organização? Antes a
      // consulta pegava "o vínculo" do chamador com .maybeSingle() e só
      // depois comparava com a organização do aluno — então quem tem
      // vínculo ativo em duas academias fazia a consulta falhar e levava
      // 403 na própria academia. Fixar a organização elimina a
      // ambiguidade em vez de desempatá-la.
      const { data: vinculosGestor, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("id")
        .eq("user_id", callerId)
        .eq("organization_id", aluno.organization_id)
        .eq("role", "gestor")
        .eq("status", "active")
        .limit(1);
      if (callerMembershipError) {
        console.error("Error loading caller membership", callerMembershipError);
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      autorizado = !!vinculosGestor?.length;
    }
    if (!autorizado) {
      return jsonResponse({ error: "Apenas o gestor da organização pode anonimizar um aluno." }, 403);
    }

    const emailAnonimizado = `anonimizado_${aluno.id}@arkefit.local`;

    // Preservar o registro financeiro e certo — auditoria fiscal precisa
    // dele. Seguir COBRANDO quem exerceu o direito de apagamento, nao. Por
    // isso a cobranca e encerrada no gateway antes, e as linhas ficam.
    const { data: orgDoAluno } = await adminClient
      .from("organizations")
      .select("status")
      .eq("id", aluno.organization_id)
      .maybeSingle();
    const ambiente = ambienteAsaas(orgDoAluno?.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const encerramento = await encerrarCobrancasDoAluno(
      adminClient,
      aluno.id,
      { api: ambiente.api, chave: ambiente.chave },
      callerId,
      "Aluno anonimizado a pedido (LGPD).",
    );
    if (!encerramento.ok) {
      return jsonResponse({ error: encerramento.erro }, 502);
    }

    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(aluno.user_id, {
      email: emailAnonimizado,
    });
    if (authUpdateError) {
      console.error("Error anonymizing auth user email", authUpdateError);
      return jsonResponse({ error: "Erro ao anonimizar o e-mail de acesso." }, 500);
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({
        full_name: `Aluno Anonimizado [${aluno.id}]`,
        cpf: null,
        phone: null,
        status: "inactive",
      })
      .eq("user_id", aluno.user_id);
    if (profileError) {
      console.error("Error anonymizing profile", profileError);
      return jsonResponse({ error: "Erro ao anonimizar o perfil." }, 500);
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .update({ status: "inactive" })
      .eq("user_id", aluno.user_id)
      .eq("organization_id", aluno.organization_id);
    if (membershipError) {
      console.error("Error deactivating membership", membershipError);
      return jsonResponse({ error: "Erro ao desativar o vínculo com a organização." }, 500);
    }

    const { error: alunoUpdateError } = await adminClient
      .from("alunos")
      .update({ anonimizado_em: new Date().toISOString() })
      .eq("id", aluno.id);
    if (alunoUpdateError) {
      console.error("Error marking aluno as anonymized", alunoUpdateError);
      return jsonResponse({ error: "Erro ao registrar a anonimização." }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in anonimizar-aluno", error);
    return jsonResponse({ error: "Erro inesperado ao anonimizar o aluno." }, 500);
  }
});

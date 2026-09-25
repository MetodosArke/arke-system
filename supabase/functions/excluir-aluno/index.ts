import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { encerrarCobrancasDoAluno } from "../_shared/encerrarCobrancas.ts";
import { apagarArquivosDoAluno } from "../_shared/arquivosDoAluno.ts";

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
    const callerIsAdminArke = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "admin_arke");

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
      return jsonResponse({ error: "Apenas o gestor da organização pode excluir um aluno." }, 403);
    }

    // Encerrar a cobranca ANTES de apagar. Apagar primeiro faz cascade em
    // `aluno_assinaturas` e deixa a assinatura viva no Asaas, cobrando uma
    // pessoa real todo mes sem registro nenhum deste lado — a orfa que a
    // varredura detecta e nao consegue corrigir. O gatilho
    // `trg_impedir_exclusao_com_cobranca_viva` garante a ordem mesmo se
    // alguem mexer aqui; esta chamada e o que faz a ordem ser possivel.
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
      "Aluno excluido da academia.",
    );
    if (!encerramento.ok) {
      return jsonResponse({ error: encerramento.erro }, 502);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(aluno.user_id);
    if (deleteError) {
      console.error("Error deleting aluno auth user", deleteError);
      return jsonResponse({ error: "Erro ao excluir o aluno." }, 500);
    }

    // Depois do banco, e não antes: se a exclusão falhasse, o aluno ficaria
    // sem o atestado que continua valendo. A cascata já levou as linhas;
    // os arquivos são o que sobrava delas.
    const arquivos = await apagarArquivosDoAluno(adminClient, aluno.organization_id, aluno.id, [
      "atestados",
      "chat-videos",
      "termos-biometria",
    ]);

    return jsonResponse({ success: true, arquivos_apagados: arquivos.apagados, arquivos_pendentes: arquivos.falhas });
  } catch (error) {
    console.error("Unexpected error in excluir-aluno", error);
    return jsonResponse({ error: "Erro inesperado ao excluir o aluno." }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Todo erro de negócio volta com HTTP 200 e `{ error }` no corpo, nunca um
// status não-2xx: supabase-js `functions.invoke` só expõe o corpo em `data`
// numa resposta 2xx — num não-2xx ele descarta o corpo e troca `error` por
// um FunctionsHttpError genérico ("Edge Function returned a non-2xx status
// code"), escondendo o motivo real (ex.: "Perfil de destino não encontrado").
const errorResponse = (mensagem: string) =>
  new Response(JSON.stringify({ error: mensagem }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type ImpersonarPayload = {
  user_id: string;
  organization_id: string;
};

// Abre uma sessão do usuário-alvo para a ArkeFit "simular" outro perfil já
// cadastrado — nunca expõe ou altera a senha do usuário simulado. Só a
// ArkeFit simula, com as duas etapas (decisão de 04/10/2026): a sessão
// simulada lê o que a pessoa lê, e o gestor que simulasse um aluno do Método
// leria a conversa com o mentor, a dieta e a anamnese, que a academia não lê.
// A sessão nasce aqui, e não no navegador, para o banco saber que ela é
// simulada: o identificador dela vai para `sessoes_simuladas` antes de ser
// entregue, e é isso que faz o banco recusar, nela, as autorizações que só a
// própria pessoa dá (decisão de 04/10/2026). O frontend guarda a própria
// sessão para poder voltar e troca pela que recebe daqui.

/** O `session_id` do JWT de acesso, sem conferir a assinatura (o token acabou de vir do Auth). */
function sessaoDoToken(accessToken: string): string | null {
  try {
    const parte = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(parte + "=".repeat((4 - (parte.length % 4)) % 4)));
    return typeof json.session_id === "string" ? json.session_id : null;
  } catch {
    return null;
  }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Sessão inválida. Faça login novamente.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return errorResponse("Configuração do servidor incompleta.");
  }

  try {
    const payload: Partial<ImpersonarPayload> = await req.json();
    const targetUserId = payload.user_id;
    const organizationId = payload.organization_id;
    if (!targetUserId) {
      return errorResponse("user_id é obrigatório.");
    }
    if (!organizationId) {
      return errorResponse("organization_id é obrigatório.");
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return errorResponse("Sessão inválida. Faça login novamente.");
    }
    if (callerId === targetUserId) {
      return errorResponse("Você já está autenticado como este usuário.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return errorResponse("Erro ao validar permissões.");
    }
    const callerIsAdminArke = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "admin_arke");
    const callerIsSuperadmin = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "superadmin");
    // Antes de olhar o perfil de destino: quem não é da ArkeFit não fica sabendo
    // se a pessoa é desta academia.
    if (!callerIsAdminArke && !callerIsSuperadmin) {
      return errorResponse("Só a ArkeFit simula perfil, com a verificação em duas etapas.");
    }

    // organization_members tem unique(organization_id, user_id) — filtrar
    // pelos dois garante no máximo uma linha. Filtrar só por user_id (como
    // este código fazia antes) quebra com um erro genérico assim que a
    // mesma pessoa tem mais de um vínculo ativo (ex.: aluno numa
    // organização e gestor em outra), porque .maybeSingle() rejeita mais
    // de uma linha — daí a UI do SuperAdmin já ter que mandar qual
    // organização quer simular, não só o user_id.
    const { data: targetMembership, error: targetMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", targetUserId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (targetMembershipError) {
      console.error("Error loading target membership", targetMembershipError);
      return errorResponse("Erro ao validar o perfil de destino.");
    }
    if (!targetMembership) {
      return errorResponse("Perfil de destino não encontrado ou sem organização ativa.");
    }

    const { data: targetUser, error: targetUserError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (targetUserError || !targetUser.user?.email) {
      console.error("Error loading target user", targetUserError);
      return errorResponse("Usuário de destino não encontrado.");
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.user.email,
    });
    if (linkError || !linkData) {
      console.error("Error generating impersonation link", linkError);
      return errorResponse("Erro ao gerar acesso de simulação.");
    }

    // A sessão é aberta aqui e marcada como simulada antes de sair. Sem a
    // marca, ela não sai: uma sessão simulada sem marca autorizaria pelo aluno.
    const verificador = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verificado, error: verificarError } = await verificador.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });
    const sessao = verificado?.session;
    const sessionId = sessao ? sessaoDoToken(sessao.access_token) : null;
    if (verificarError || !sessao || !sessionId) {
      console.error("Falha ao abrir a sessão de simulação", verificarError?.status ?? "");
      return errorResponse("Erro ao gerar acesso de simulação.");
    }
    const { error: marcaError } = await adminClient
      .from("sessoes_simuladas")
      .insert({ session_id: sessionId, alvo_user_id: targetUserId, ator_user_id: callerId });
    if (marcaError) {
      console.error("Falha ao marcar a sessão de simulação", marcaError.code);
      await adminClient.auth.admin.signOut(sessao.access_token, "local").catch(() => undefined);
      return errorResponse("Erro ao gerar acesso de simulação.");
    }

    // Assumir a sessão de outra pessoa é a ação mais sensível do sistema, e
    // é a única que não mexe em nenhuma tabela — nenhum trigger a veria.
    // Registrar aqui é o único jeito de ela deixar rastro.
    const { data: organizacao } = await adminClient
      .from("organizations")
      .select("nome")
      .eq("id", organizationId)
      .maybeSingle();

    const { error: auditoriaError } = await adminClient.rpc("registrar_auditoria", {
      _ator_user_id: callerId,
      _acao: "perfil.simulado",
      _entidade: "auth.users",
      _entidade_id: targetUserId,
      _organizacao_nome: organizacao?.nome ?? null,
      _detalhes: {
        papel_alvo: targetMembership.role,
        email_alvo: targetUser.user.email,
        ator_admin_arke: callerIsAdminArke,
        ator_superadmin: callerIsSuperadmin,
      },
    });
    if (auditoriaError) console.error("Falha ao registrar auditoria de simulação", auditoriaError);

    return jsonResponse({
      email: targetUser.user.email,
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
    });
  } catch (error) {
    console.error("Unexpected error in impersonar-perfil", error);
    return errorResponse("Erro inesperado ao simular o perfil.");
  }
});

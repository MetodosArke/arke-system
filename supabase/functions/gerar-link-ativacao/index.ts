import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";

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

type GerarLinkPayload = {
  user_id: string;
};

// Sem 0/O/1/l/I para evitar confusão ao digitar/ler o código.
const ALFABETO_CODIGO_CURTO = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

function gerarCodigoCurto(tamanho = 8): string {
  let codigo = "";
  for (let i = 0; i < tamanho; i++) {
    codigo += ALFABETO_CODIGO_CURTO[Math.floor(Math.random() * ALFABETO_CODIGO_CURTO.length)];
  }
  return codigo;
}

// Gera um link de ativação/definição de senha tokenizado (via
// supabase.auth.admin.generateLink, type "recovery") para o botão
// "Enviar Ativação via WhatsApp" — não envia e-mail, apenas devolve o
// link para o staff colar na mensagem do WhatsApp.
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
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://arkefit.com.br";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<GerarLinkPayload> = await req.json();
    const targetUserId = payload.user_id?.trim();
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

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsAdminArke = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "admin_arke");

    // Listas, não .maybeSingle(): tanto o alvo quanto o chamador podem ter
    // vínculo ativo em mais de uma academia, e nesse caso a consulta
    // falhava — o aluno simplesmente não recebia o link de ativação. O
    // filtro de status também faltava, então vínculo encerrado entrava na
    // conta.
    const { data: vinculosAlvo, error: targetMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", targetUserId)
      .eq("status", "active");
    if (targetMembershipError) {
      console.error("Error loading target membership", targetMembershipError);
      return jsonResponse({ error: "Erro ao validar o aluno." }, 500);
    }
    if (!vinculosAlvo?.length) {
      return jsonResponse({ error: "Aluno não encontrado nesta organização." }, 404);
    }

    let autorizado = callerIsAdminArke;
    if (!autorizado) {
      const { data: vinculosChamador, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", callerId)
        .eq("status", "active");
      if (callerMembershipError) {
        console.error("Error loading caller membership", callerMembershipError);
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      // Professor/nutricionista só geram link de ativação para ALUNO — sem
      // isso, qualquer um dos dois conseguiria gerar um link de recovery
      // válido para a conta de outro membro da equipe (inclusive o gestor)
      // e assumir esse acesso. Gestor da mesma org pode gerar para
      // qualquer papel (já é o nível de permissão mais alto dentro da org).
      //
      // Com listas dos dois lados, a regra passa a ser: existe alguma
      // organização em comum onde o chamador tenha papel suficiente para o
      // papel que o alvo tem ALI. Isso não afrouxa nada — continua exigindo
      // organização compartilhada e o mesmo par de papéis —, e fecha um
      // buraco sutil que a versão anterior tinha: ela comparava o papel do
      // alvo num vínculo possivelmente de outra academia.
      autorizado = (vinculosChamador ?? []).some((chamador) =>
        (vinculosAlvo ?? []).some(
          (alvo) =>
            alvo.organization_id === chamador.organization_id &&
            (chamador.role === "gestor" ||
              (["professor", "nutricionista"].includes(chamador.role) && alvo.role === "aluno"))
        )
      );
    }
    if (!autorizado) {
      return jsonResponse({ error: "Você não tem permissão para gerar este link." }, 403);
    }

    const { data: targetUser, error: targetUserError } = await adminClient.auth.admin.getUserById(targetUserId);
    if (targetUserError || !targetUser.user?.email) {
      console.error("Error loading target user", targetUserError);
      return jsonResponse({ error: "Usuário de destino não encontrado." }, 404);
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: targetUser.user.email,
      // redirectTo aponta pra /auth/definir-senha (não /auth/reset-password):
      // isto é uma ativação de cadastro, não uma recuperação de senha — o
      // aluno deve cair direto na tela de "defina sua senha e entre", sem
      // passar pela tela de recuperação. O index.html reconhece esse path
      // no link (mesmo com type=recovery) e roteia pra lá.
      options: { redirectTo: `${siteUrl}/#/auth/definir-senha` },
    });
    if (linkError || !linkData) {
      console.error("Error generating activation link", linkError);
      return jsonResponse({ error: "Erro ao gerar o link de ativação." }, 500);
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    let code = "";
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      code = gerarCodigoCurto();
      const { error: insertError } = await adminClient.from("links_ativacao").insert({
        code,
        action_link: linkData.properties.action_link,
        user_id: targetUserId,
        expires_at: expiresAt,
      });
      if (!insertError) break;
      if (insertError.code !== "23505") {
        console.error("Error saving short link", insertError);
        return jsonResponse({ error: "Erro ao gerar o link de ativação." }, 500);
      }
      if (tentativa === 4) {
        console.error("Could not generate a unique short code after 5 attempts");
        return jsonResponse({ error: "Erro ao gerar o link de ativação." }, 500);
      }
    }

    return jsonResponse({ action_link: `${siteUrl}/cadastro/${code}` });
  } catch (error) {
    console.error("Unexpected error in gerar-link-ativacao", error);
    return jsonResponse({ error: "Erro inesperado ao gerar o link de ativação." }, 500);
  }
});

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

type TipoOrg = "academia" | "studio";
const TIPOS_VALIDOS = new Set<TipoOrg>(["academia", "studio"]);
const PLANOS_VALIDOS = new Set(["starter", "growth", "enterprise", "custom"]);
const STATUS_VALIDOS = new Set(["trial", "ativo"]);

type CriarOrganizacaoPayload = {
  nome: string;
  slug: string;
  tipo: TipoOrg;
  gestor_email: string;
  gestor_nome: string;
  plano_b2b: "starter" | "growth" | "enterprise" | "custom";
  status: "trial" | "ativo";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugify = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const mensagemIndicaEmailJaCadastrado = (mensagem: string | undefined | null) => {
  const texto = (mensagem ?? "").toLowerCase();
  return texto.includes("already been registered") || texto.includes("already registered") || texto.includes("already exists");
};

// Onboarding Assistido de Tenants: SuperAdmin cadastra uma nova academia
// ou studio. O gestor principal pode ser um e-mail totalmente novo (recebe
// o convite padrão de primeiro acesso, com senha temporária nunca
// exposta) ou um e-mail que já tem conta no Supabase Auth (ex.: já é
// gestor de outra organização) — nesse caso a conta existente é vinculada
// à organização nova como gestor, sem tentar convidar de novo (o que
// sempre falharia com "already registered"), e recebe um e-mail avisando
// do novo vínculo em vez do e-mail de convite. Se o envio do e-mail (em
// qualquer um dos dois casos) falhar por qualquer motivo, a organização e
// o vínculo do gestor são criados normalmente — só a UI é avisada de que
// o e-mail não saiu, para o SuperAdmin repassar o acesso manualmente
// (ex.: via /superadmin, ação equivalente à de "gerar-link-ativacao").
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
    const payload: Partial<CriarOrganizacaoPayload> = await req.json();
    const nome = payload.nome?.trim();
    const slugBruto = payload.slug?.trim();
    const tipo = payload.tipo;
    const gestorEmail = payload.gestor_email?.trim().toLowerCase();
    const gestorNome = payload.gestor_nome?.trim();
    const planoB2b = payload.plano_b2b;
    const status = payload.status;

    if (!nome) return jsonResponse({ error: "Nome da unidade é obrigatório." }, 400);
    if (!tipo || !TIPOS_VALIDOS.has(tipo)) {
      return jsonResponse({ error: "Tipo inválido. Use academia ou studio." }, 400);
    }
    if (!gestorEmail || !EMAIL_RE.test(gestorEmail)) {
      return jsonResponse({ error: "E-mail do gestor inválido." }, 400);
    }
    if (!gestorNome) return jsonResponse({ error: "Nome do gestor é obrigatório." }, 400);
    if (!planoB2b || !PLANOS_VALIDOS.has(planoB2b)) {
      return jsonResponse({ error: "Plano inválido." }, 400);
    }
    if (!status || !STATUS_VALIDOS.has(status)) {
      return jsonResponse({ error: "Status inválido. Use trial ou ativo." }, 400);
    }

    const slugNormalizado = slugify(slugBruto || nome);
    if (!slugNormalizado) {
      return jsonResponse({ error: "Slug inválido." }, 400);
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
    const callerIsSuperadmin = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "superadmin");
    if (!callerIsSuperadmin) {
      return jsonResponse({ error: "Apenas o Super Admin ArkeFit pode cadastrar organizações." }, 403);
    }

    const { data: organizacao, error: orgError } = await adminClient
      .from("organizations")
      .insert({
        nome,
        slug: slugNormalizado,
        tipo,
        plano_b2b: planoB2b,
        status,
      })
      .select("id")
      .single();
    if (orgError || !organizacao) {
      console.error("Error creating organization", orgError);
      const slugDuplicado = orgError?.code === "23505";
      return jsonResponse(
        { error: slugDuplicado ? "Esse slug já está em uso por outra organização." : "Erro ao criar a organização." },
        slugDuplicado ? 409 : 500
      );
    }
    const organizationId = organizacao.id as string;

    const rollbackOrganizacao = async () => {
      await adminClient.from("organizations").delete().eq("id", organizationId).catch((e) =>
        console.error("rollback organization", e)
      );
    };

    // ---------------------------------------------------------------
    // Resolve o gestor: conta nova (convite) ou conta já existente
    // (vincula à organização nova). Qualquer problema no ENVIO do
    // e-mail — em qualquer um dos dois caminhos — não derruba a criação
    // da organização; só fica registrado em `aviso` para a UI mostrar.
    // ---------------------------------------------------------------
    let gestorUserId: string | null = null;
    let gestorJaExistia = false;
    let aviso: string | null = null;

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(gestorEmail, {
      data: { full_name: gestorNome },
      redirectTo: `${siteUrl}/#/auth/definir-senha`,
    });

    if (!inviteError && invited?.user) {
      gestorUserId = invited.user.id;
    } else if (mensagemIndicaEmailJaCadastrado(inviteError?.message)) {
      // Requisito 1: e-mail já tem conta — não tenta inviteUserByEmail de
      // novo (sempre falharia), só localiza o user_id e vincula.
      gestorJaExistia = true;
      const { data: userIdExistente, error: buscaError } = await adminClient.rpc("buscar_user_id_por_email", {
        _email: gestorEmail,
      });
      if (buscaError || !userIdExistente) {
        console.error("Error looking up existing gestor by email", buscaError);
        await rollbackOrganizacao();
        return jsonResponse(
          { error: "Já existe uma conta com esse e-mail, mas não foi possível localizá-la para vincular à organização." },
          500
        );
      }
      gestorUserId = userIdExistente as string;
    } else {
      // Requisito 3 (fallback): o convite falhou por outro motivo (ex.:
      // SMTP indisponível) — cria a conta sem depender do envio de e-mail
      // (generateLink nunca envia e-mail sozinho, só gera o link/token,
      // mesmo mecanismo já usado em gerar-link-ativacao) em vez de abortar.
      console.error("Error inviting gestor, falling back to silent account creation", inviteError);
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email: gestorEmail,
        options: { data: { full_name: gestorNome }, redirectTo: `${siteUrl}/#/auth/definir-senha` },
      });
      if (linkError || !linkData?.user) {
        console.error("Error creating gestor account via generateLink fallback", linkError);
        await rollbackOrganizacao();
        return jsonResponse({ error: inviteError?.message ?? "Falha ao convidar o gestor." }, 400);
      }
      gestorUserId = linkData.user.id;
      aviso = "Não foi possível enviar o e-mail de convite automático.";
    }

    const rollback = async () => {
      if (!gestorJaExistia && gestorUserId) {
        await adminClient.auth.admin.deleteUser(gestorUserId).catch((e) => console.error("rollback deleteUser", e));
      }
      await rollbackOrganizacao();
    };

    // Conta nova: prepara o perfil. Conta já existente mantém o perfil que
    // já tinha (pode já ser gestora de outra organização, com nome/avatar
    // próprios — não sobrescreve silenciosamente por causa desta org nova).
    if (!gestorJaExistia) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({ user_id: gestorUserId, full_name: gestorNome, status: "active" }, { onConflict: "user_id" });
      if (profileError) {
        console.error("Error upserting profile", profileError);
        await rollback();
        return jsonResponse({ error: "Erro ao preparar o perfil do gestor." }, 500);
      }
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: gestorUserId, role: "gestor", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o gestor à organização." }, 500);
    }

    // Requisito 1 (fim): avisa por e-mail o gestor já existente sobre o
    // novo vínculo — via magic link (única forma nativa do Supabase Auth
    // de mandar e-mail para uma conta já confirmada). Em try/catch isolado:
    // se falhar, o vínculo já foi criado, só marca o aviso (Requisito 3).
    if (gestorJaExistia) {
      try {
        const publicClient = createClient(supabaseUrl, anonKey);
        const { error: notifyError } = await publicClient.auth.signInWithOtp({
          email: gestorEmail,
          options: { shouldCreateUser: false, emailRedirectTo: siteUrl },
        });
        if (notifyError) throw notifyError;
      } catch (notifyErr) {
        console.error("Error notifying existing gestor about new organization", notifyErr);
        aviso = "Não foi possível enviar o e-mail avisando o gestor sobre a nova organização.";
      }
    }

    return jsonResponse({
      organization_id: organizationId,
      gestor_user_id: gestorUserId,
      gestor_ja_existia: gestorJaExistia,
      aviso,
    });
  } catch (error) {
    console.error("Unexpected error in criar-organizacao-superadmin", error);
    return jsonResponse({ error: "Erro inesperado ao criar a organização." }, 500);
  }
});

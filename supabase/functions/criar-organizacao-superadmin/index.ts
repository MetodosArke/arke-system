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

// Onboarding Assistido de Tenants: SuperAdmin cadastra uma nova academia
// ou studio e já convida o gestor principal por e-mail — mesma família de
// convites (inviteUserByEmail, sem senha temporária exposta) usada em
// convidar-membro e convidar-profissional-autonomo, aqui restrita ao
// papel global "superadmin".
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
    const callerIsSuperadmin = (callerRoles ?? []).some((r) => r.role === "superadmin");
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

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(gestorEmail, {
      data: { full_name: gestorNome },
      redirectTo: siteUrl,
    });
    if (inviteError || !invited.user) {
      console.error("Error inviting gestor", inviteError);
      await rollbackOrganizacao();
      const alreadyExists = inviteError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe um usuário cadastrado com esse e-mail."
            : inviteError?.message ?? "Falha ao convidar o gestor.",
        },
        alreadyExists ? 409 : 400
      );
    }
    const newUserId = invited.user.id;

    const rollback = async () => {
      await adminClient.auth.admin.deleteUser(newUserId).catch((e) => console.error("rollback deleteUser", e));
      await rollbackOrganizacao();
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert({ user_id: newUserId, full_name: gestorNome, status: "active" }, { onConflict: "user_id" });
    if (profileError) {
      console.error("Error upserting profile", profileError);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do gestor." }, 500);
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: newUserId, role: "gestor", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o gestor à organização." }, 500);
    }

    return jsonResponse({ organization_id: organizationId, gestor_user_id: newUserId });
  } catch (error) {
    console.error("Unexpected error in criar-organizacao-superadmin", error);
    return jsonResponse({ error: "Erro inesperado ao criar a organização." }, 500);
  }
});

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

type Especialidade = "professor" | "nutricionista";
const ESPECIALIDADES_VALIDAS = new Set<Especialidade>(["professor", "nutricionista"]);

type ConvidarProfissionalPayload = {
  email: string;
  full_name: string;
  telefone?: string;
  especialidade: Especialidade;
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

// SuperAdmin convida um Personal Trainer ou Nutricionista autônomo: cria
// uma organização de 1 (tipo = profissional_autonomo) para ele, onde vira
// "gestor" da própria carteira de alunos — reaproveita as mesmas telas e
// RLS de staff já existentes, sem depender de uma academia. Não é o mesmo
// fluxo de convidar-membro (que exige um gestor de academia já existente).
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
    const payload: Partial<ConvidarProfissionalPayload> = await req.json();
    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.full_name?.trim();
    const telefone = payload.telefone?.trim() || null;
    const especialidade = payload.especialidade;

    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (!fullName) {
      return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    }
    if (!especialidade || !ESPECIALIDADES_VALIDAS.has(especialidade)) {
      return jsonResponse({ error: "Selecione a especialidade: Personal Trainer ou Nutricionista." }, 400);
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
      return jsonResponse({ error: "Apenas o Super Admin ArkeFit pode convidar profissionais autônomos." }, 403);
    }

    const slugBase = slugify(fullName) || "profissional";
    const slug = `${slugBase}-${crypto.randomUUID().slice(0, 8)}`;

    const { data: organizacao, error: orgError } = await adminClient
      .from("organizations")
      .insert({
        nome: fullName,
        slug,
        tipo: "profissional_autonomo",
        plano_b2b: "autonomo",
        especialidade_profissional: especialidade,
        // Plano B2B vale desde o primeiro dia; trial é ferramenta de teste que
        // o Super Admin atribui à parte, na Visão Master.
        status: "ativo",
      })
      .select("id")
      .single();
    if (orgError || !organizacao) {
      console.error("Error creating organization", orgError);
      return jsonResponse({ error: "Erro ao criar a organização do profissional." }, 500);
    }
    const organizationId = organizacao.id as string;

    const rollbackOrganizacao = async () => {
      await adminClient.from("organizations").delete().eq("id", organizationId).catch((e) =>
        console.error("rollback organization", e)
      );
    };

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${siteUrl}/#/auth/definir-senha`,
    });
    if (inviteError || !invited.user) {
      console.error("Error inviting user", inviteError);
      await rollbackOrganizacao();
      const alreadyExists = inviteError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe um usuário cadastrado com esse e-mail."
            : inviteError?.message ?? "Falha ao convidar o profissional.",
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
      .upsert(
        { user_id: newUserId, full_name: fullName, phone: telefone, status: "active" },
        { onConflict: "user_id" }
      );
    if (profileError) {
      console.error("Error upserting profile", profileError);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do profissional." }, 500);
    }

    // Gestor da própria organização de 1: acesso total às telas de staff
    // (alunos, treinos, dietas, avaliações) escopadas por RLS ao próprio tenant.
    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: newUserId, role: "gestor", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o profissional à organização." }, 500);
    }

    return jsonResponse({ user_id: newUserId, organization_id: organizationId });
  } catch (error) {
    console.error("Unexpected error in convidar-profissional-autonomo", error);
    return jsonResponse({ error: "Erro inesperado ao convidar o profissional." }, 500);
  }
});

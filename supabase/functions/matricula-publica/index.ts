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

const NIVEIS_VALIDOS = new Set(["essencial", "integrado", "elite"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MatriculaPayload = {
  slug: string;
  nivel_atacado: "essencial" | "integrado" | "elite";
  full_name: string;
  email: string;
  telefone?: string;
  cpf?: string;
  password: string;
};

// Auto-matrícula pública (rota /p/:slug): qualquer visitante pode criar a
// própria conta de aluno vinculada à organização do slug, sem precisar de
// um convite de um gestor. Usa service_role para criar o usuário já com a
// senha escolhida pelo próprio aluno (sem e-mail de convite — o fluxo é
// self-service) e vinculá-lo como aluno da organização.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<MatriculaPayload> = await req.json();
    const slug = payload.slug?.trim().toLowerCase();
    const nivelAtacado = payload.nivel_atacado;
    const fullName = payload.full_name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;
    const password = payload.password;

    if (!slug) return jsonResponse({ error: "Academia inválida." }, 400);
    if (!fullName) return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    if (!email || !EMAIL_RE.test(email)) return jsonResponse({ error: "E-mail inválido." }, 400);
    if (!password || password.length < 6) {
      return jsonResponse({ error: "A senha deve ter no mínimo 6 caracteres." }, 400);
    }
    if (!nivelAtacado || !NIVEIS_VALIDOS.has(nivelAtacado)) {
      return jsonResponse({ error: "Selecione um plano válido." }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, status")
      .eq("slug", slug)
      .maybeSingle();

    if (orgError) {
      console.error("Error loading organization", orgError);
      return jsonResponse({ error: "Erro ao buscar a academia." }, 500);
    }
    if (!org || !["ativo", "trial"].includes(org.status)) {
      return jsonResponse({ error: "Academia não encontrada ou não está aceitando matrículas no momento." }, 404);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      console.error("Error creating user", createError);
      const alreadyExists = createError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe uma conta cadastrada com esse e-mail. Faça login."
            : createError?.message ?? "Falha ao criar a conta.",
        },
        alreadyExists ? 409 : 400
      );
    }

    const newUserId = created.user.id;
    const rollback = async () => {
      await admin.auth.admin.deleteUser(newUserId).catch((e) => console.error("rollback deleteUser", e));
    };

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" }, { onConflict: "user_id" });
    if (profileError) {
      console.error("Error upserting profile", profileError);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .insert({ organization_id: org.id, user_id: newUserId, role: "aluno", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à academia." }, 500);
    }

    // Matrícula pública já é a adesão de verdade ao Método ARKE (o
    // aluno escolheu o nível e vai pagar por ele) — diferente do
    // cadastro/importação feito pela academia, aqui não faz sentido
    // nascer "sem_adesao".
    const { error: alunoError } = await admin.from("alunos").insert({
      organization_id: org.id,
      user_id: newUserId,
      nivel_atacado: nivelAtacado,
      metodo_arke_status: "ativo",
      metodo_arke_ativado_em: new Date().toISOString(),
    });
    if (alunoError) {
      console.error("Error inserting aluno", alunoError);
      await admin.from("organization_members").delete().eq("user_id", newUserId);
      await rollback();
      return jsonResponse({ error: "Erro ao criar o cadastro de aluno." }, 500);
    }

    return jsonResponse({ user_id: newUserId });
  } catch (error) {
    console.error("Unexpected error in matricula-publica", error);
    return jsonResponse({ error: "Erro inesperado ao processar a matrícula." }, 500);
  }
});

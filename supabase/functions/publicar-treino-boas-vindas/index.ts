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

// Resolve o "app vazio" do primeiro acesso: chamada pelo próprio aluno
// (Onboarding.tsx) logo após concluir a anamnese M.A.P.A.®, OU pelo
// staff em lote logo após uma importação (AdminImportarAlunos.tsx,
// payload { aluno_id }) — pra quem vem de um sistema antigo já ter uma
// rotina no primeiro dia, sem depender do aluno passar pelo onboarding
// sozinho. Publica um treino inicial genérico (modelo "Adaptação A",
// já semeado em toda organização — ver seed_templates_treino_padrao).
// Usa service_role porque nem aluno nem, no caso do import, o registro
// em nome de outra pessoa tem (ou deve ter) permissão de INSERT direto
// em `treinos` — só via publicar_treino, que já resolve o snapshot
// imutável.
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

    let alunoIdAlvo: string | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.aluno_id === "string") alunoIdAlvo = body.aluno_id;
    } catch {
      // sem body = chamada do aluno pra si mesmo (fluxo de onboarding), segue normal.
    }

    let aluno: { id: string; organization_id: string } | null = null;

    if (alunoIdAlvo) {
      // Chamada em nome de outro aluno (import em massa) — só staff da
      // organização dele pode disparar.
      const { data: alunoAlvo, error: alunoAlvoError } = await adminClient
        .from("alunos")
        .select("id, organization_id")
        .eq("id", alunoIdAlvo)
        .maybeSingle();
      if (alunoAlvoError) {
        console.error("Error loading aluno alvo", alunoAlvoError);
        return jsonResponse({ error: "Erro ao carregar o cadastro do aluno." }, 500);
      }
      if (!alunoAlvo) {
        return jsonResponse({ error: "Aluno não encontrado." }, 404);
      }
      const { data: membership } = await adminClient
        .from("organization_members")
        .select("role")
        .eq("user_id", callerId)
        .eq("organization_id", alunoAlvo.organization_id)
        .eq("status", "active")
        .in("role", ["gestor", "professor", "recepcao", "nutricionista"])
        .maybeSingle();
      if (!membership) {
        return jsonResponse({ error: "Sem permissão para publicar treino para este aluno." }, 403);
      }
      aluno = alunoAlvo;
    } else {
      const { data: alunoProprio, error: alunoError } = await adminClient
        .from("alunos")
        .select("id, organization_id")
        .eq("user_id", callerId)
        .maybeSingle();
      if (alunoError) {
        console.error("Error loading aluno", alunoError);
        return jsonResponse({ error: "Erro ao carregar o cadastro do aluno." }, 500);
      }
      if (!alunoProprio) {
        return jsonResponse({ error: "Cadastro de aluno não encontrado." }, 404);
      }
      aluno = alunoProprio;
    }

    // Idempotente: se já existe treino ativo (ex.: o professor já
    // publicou algo, ou o aluno recarregou a tela), não sobrepõe nada.
    const { data: treinoExistente, error: treinoExistenteError } = await adminClient
      .from("treinos")
      .select("id")
      .eq("aluno_id", aluno.id)
      .eq("status", "ativo")
      .limit(1)
      .maybeSingle();
    if (treinoExistenteError) {
      console.error("Error checking existing treino", treinoExistenteError);
      return jsonResponse({ error: "Erro ao verificar treino existente." }, 500);
    }
    if (treinoExistente) {
      return jsonResponse({ published: false, reason: "already_has_active_treino" });
    }

    const { data: modelo, error: modeloError } = await adminClient
      .from("modelos_treino")
      .select("id")
      .eq("organization_id", aluno.organization_id)
      .eq("titulo", "Adaptação A")
      .maybeSingle();
    if (modeloError) {
      console.error("Error loading modelo de boas-vindas", modeloError);
      return jsonResponse({ error: "Erro ao carregar o modelo de treino." }, 500);
    }
    if (!modelo) {
      // Organização sem o template padrão (ex.: apagado manualmente) —
      // não é motivo pra falhar o onboarding, só não publica nada.
      return jsonResponse({ published: false, reason: "no_default_template" });
    }

    const { data: treinoId, error: publicarError } = await adminClient.rpc("publicar_treino", {
      _aluno_id: aluno.id,
      _modelo_id: modelo.id,
      _titulo: "Treino de Boas-vindas — Adaptação",
    });
    if (publicarError) {
      console.error("Error publishing welcome treino", publicarError);
      return jsonResponse({ error: "Erro ao publicar o treino de boas-vindas." }, 500);
    }

    return jsonResponse({ published: true, treino_id: treinoId });
  } catch (error) {
    console.error("Unexpected error in publicar-treino-boas-vindas", error);
    return jsonResponse({ error: "Erro inesperado ao publicar o treino de boas-vindas." }, 500);
  }
});

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

type SincronizarPayload = {
  device_token: string;
};

// ARKE® Gateway Local — alimenta o cache offline do middleware Node.js
// (SQLite/NeDB local) com a lista de alunos ativos da organização, para
// que a catraca continue liberando/bloqueando mesmo sem internet. O
// gateway chama isto periodicamente (ex.: a cada poucos minutos) e
// substitui seu cache local pelo resultado. Mesmo padrão de autenticação
// via device_token de catraca-validar-acesso (verify_jwt=false).
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

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload: Partial<SincronizarPayload> = await req.json();
    const deviceToken = payload.device_token?.trim();
    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);

    const { data: catraca, error: catracaError } = await admin
      .from("organizacao_catracas")
      .select("id, organization_id, status")
      .eq("device_token", deviceToken)
      .maybeSingle();
    if (catracaError) {
      console.error("Erro ao consultar catraca:", catracaError);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) {
      return jsonResponse({ error: "Dispositivo não autorizado." }, 401);
    }

    const { data: alunos, error: alunosError } = await admin
      .from("alunos")
      .select("id, user_id, aluno_assinaturas(status)")
      .eq("organization_id", catraca.organization_id);
    if (alunosError) {
      console.error("Erro ao listar alunos:", alunosError);
      return jsonResponse({ error: "Falha ao listar alunos." }, 500);
    }

    const userIds = (alunos ?? []).map((a) => a.user_id);
    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from("profiles").select("user_id, full_name, cpf").in("user_id", userIds)
      : { data: [] as { user_id: string; full_name: string; cpf: string | null }[], error: null };
    if (profilesError) {
      console.error("Erro ao listar perfis:", profilesError);
      return jsonResponse({ error: "Falha ao listar perfis." }, 500);
    }

    const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    const lista = (alunos ?? [])
      .map((a) => {
        const profile = profileByUserId.get(a.user_id);
        const cpf = profile?.cpf?.replace(/\D/g, "") ?? "";
        if (!cpf) return null; // sem CPF cadastrado, não dá para validar offline por CPF
        const assinatura = Array.isArray(a.aluno_assinaturas) ? a.aluno_assinaturas[0] : a.aluno_assinaturas;
        return {
          aluno_id: a.id,
          cpf,
          nome: profile?.full_name ?? "",
          inadimplente: assinatura?.status === "atrasada",
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return jsonResponse({ alunos: lista, sincronizado_em: new Date().toISOString() });
  } catch (error) {
    console.error("Erro inesperado em catraca-sincronizar-alunos:", error);
    return jsonResponse({ error: "Erro inesperado ao sincronizar alunos." }, 500);
  }
});

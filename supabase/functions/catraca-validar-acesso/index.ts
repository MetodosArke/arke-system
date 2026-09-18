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

const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

type ValidarAcessoPayload = {
  device_token: string;
  cpf: string;
};

// ARKE® Gateway Local — validação de acesso de catracas.
// Dispositivo se autentica com um device_token próprio (não é um usuário
// autenticado do Supabase Auth), por isso a função roda com verify_jwt
// desabilitado e faz a própria checagem de autorização: o token precisa
// bater com uma catraca cadastrada e ativa antes de qualquer consulta a
// dados de aluno. Alvo de latência: responder em menos de 300ms.
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
    const payload: Partial<ValidarAcessoPayload> = await req.json();
    const deviceToken = payload.device_token?.trim();
    const cpf = payload.cpf ? somenteDigitos(payload.cpf) : "";

    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    if (!cpf) return jsonResponse({ error: "cpf é obrigatório." }, 400);

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
      return jsonResponse({ liberado: false, motivo: "Dispositivo não autorizado." }, 401);
    }
    if (catraca.status !== "ativo") {
      await admin.from("acessos_catraca_logs").insert({
        organization_id: catraca.organization_id,
        catraca_id: catraca.id,
        cpf_consultado: cpf,
        resultado: "negado_catraca_inativa",
      });
      return jsonResponse({ liberado: false, motivo: "Dispositivo inativo." });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, full_name")
      .eq("cpf", cpf)
      .maybeSingle();

    const { data: aluno } = profile
      ? await admin
          .from("alunos")
          .select("id, aluno_assinaturas(status)")
          .eq("organization_id", catraca.organization_id)
          .eq("user_id", profile.user_id)
          .maybeSingle()
      : { data: null };

    if (!profile || !aluno) {
      await admin.from("acessos_catraca_logs").insert({
        organization_id: catraca.organization_id,
        catraca_id: catraca.id,
        cpf_consultado: cpf,
        resultado: "negado_nao_encontrado",
      });
      return jsonResponse({ liberado: false, motivo: "Aluno não encontrado nesta academia." });
    }

    const assinatura = Array.isArray(aluno.aluno_assinaturas)
      ? aluno.aluno_assinaturas[0]
      : aluno.aluno_assinaturas;
    const inadimplente = assinatura?.status === "atrasada";

    const resultado = inadimplente ? "negado_inadimplente" : "liberado";
    await admin.from("acessos_catraca_logs").insert({
      organization_id: catraca.organization_id,
      catraca_id: catraca.id,
      aluno_id: aluno.id,
      cpf_consultado: cpf,
      resultado,
    });

    if (inadimplente) {
      return jsonResponse({ liberado: false, motivo: "Assinatura em atraso.", aluno_nome: profile.full_name });
    }

    return jsonResponse({ liberado: true, motivo: "Acesso liberado.", aluno_nome: profile.full_name });
  } catch (error) {
    console.error("Erro inesperado em catraca-validar-acesso:", error);
    return jsonResponse({ error: "Erro inesperado ao validar acesso." }, 500);
  }
});

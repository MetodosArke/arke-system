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

type Parceiro = "wellhub" | "totalpass";
const PARCEIROS_VALIDOS = new Set<Parceiro>(["wellhub", "totalpass"]);

type CheckinPayload = {
  catraca_id: string;
  parceiro: Parceiro;
  nome_visitante?: string;
};

// Liberação de catraca para visitantes esporádicos de agregadores
// (Wellhub/Gympass, TotalPass) que não são necessariamente `alunos`
// cadastrados na academia. Sem integração automática com a API dos
// parceiros ainda (credenciais/documentação pendentes) — a recepção
// confere visualmente o código mostrado no app do visitante (ex.: no
// próprio portal do parceiro) e confirma aqui, o que libera a catraca e
// grava o log normalmente em acessos_catraca_logs. Chamada com o JWT do
// funcionário logado (não device_token de catraca), diferente das demais
// funções deste subsistema.
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
    const payload: Partial<CheckinPayload> = await req.json();
    const catracaId = payload.catraca_id?.trim();
    const parceiro = payload.parceiro;
    const nomeVisitante = payload.nome_visitante?.trim() || null;

    if (!catracaId) return jsonResponse({ error: "catraca_id é obrigatório." }, 400);
    if (!parceiro || !PARCEIROS_VALIDOS.has(parceiro)) {
      return jsonResponse({ error: "parceiro inválido. Use wellhub ou totalpass." }, 400);
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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: catraca, error: catracaError } = await admin
      .from("organizacao_catracas")
      .select("id, organization_id, status")
      .eq("id", catracaId)
      .maybeSingle();
    if (catracaError) {
      console.error("Erro ao consultar catraca:", catracaError);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) {
      return jsonResponse({ error: "Catraca não encontrada." }, 404);
    }

    const { data: isStaff, error: staffError } = await admin.rpc("is_org_staff", {
      _user_id: callerId,
      _organization_id: catraca.organization_id,
    });
    if (staffError) {
      console.error("Erro ao validar permissões:", staffError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    if (!isStaff) {
      return jsonResponse({ error: "Você não tem permissão para liberar acessos nesta academia." }, 403);
    }

    if (catraca.status !== "ativo") {
      return jsonResponse({ liberado: false, motivo: "Dispositivo inativo." });
    }

    const { data: credencial, error: credencialError } = await admin
      .from("organizacao_credenciais_parceiro")
      .select("id, ativo")
      .eq("organization_id", catraca.organization_id)
      .eq("parceiro", parceiro)
      .maybeSingle();
    if (credencialError) {
      console.error("Erro ao consultar credencial de parceiro:", credencialError);
      return jsonResponse({ error: "Falha ao validar parceiro." }, 500);
    }
    if (!credencial || !credencial.ativo) {
      return jsonResponse({
        liberado: false,
        motivo: "Este parceiro não está habilitado para esta academia.",
      });
    }

    const { error: insertError } = await admin.from("acessos_catraca_logs").insert({
      organization_id: catraca.organization_id,
      catraca_id: catraca.id,
      resultado: "liberado_parceiro_externo",
      parceiro_externo: parceiro,
      nome_visitante_externo: nomeVisitante,
      confirmado_por: callerId,
    });
    if (insertError) {
      console.error("Erro ao gravar log de check-in:", insertError);
      return jsonResponse({ error: "Falha ao registrar o acesso." }, 500);
    }

    return jsonResponse({ liberado: true, motivo: "Acesso liberado." });
  } catch (error) {
    console.error("Erro inesperado em catraca-checkin-parceiro-externo:", error);
    return jsonResponse({ error: "Erro inesperado ao liberar o acesso." }, 500);
  }
});

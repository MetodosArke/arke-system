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

const RESULTADOS_VALIDOS = new Set([
  "liberado",
  "negado_inadimplente",
  "negado_nao_encontrado",
  "negado_catraca_inativa",
  "negado_sem_agendamento",
  "negado_falha_verificacao_agendamento",
]);

type LogOffline = {
  aluno_id?: string | null;
  cpf_consultado: string;
  resultado: string;
  ocorrido_em: string; // ISO — hora real do evento, capturada offline pelo gateway
};

type SincronizarLogsPayload = {
  device_token: string;
  logs: LogOffline[];
};

// ARKE® Gateway Local — recebe em lote os acessos que o middleware Node.js
// validou localmente (cache offline) enquanto a internet estava fora, e
// grava em acessos_catraca_logs com validado_offline=true, preservando o
// horário real do evento (ocorrido_em) em vez da hora da sincronização.
// Idempotente por natureza best-effort: o gateway só deve reenviar logs
// que ainda não confirmou como sincronizados (controle fica do lado dele).
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
    const payload: Partial<SincronizarLogsPayload> = await req.json();
    const deviceToken = payload.device_token?.trim();
    const logs = Array.isArray(payload.logs) ? payload.logs : [];

    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    if (logs.length === 0) return jsonResponse({ inseridos: 0 });
    if (logs.length > 500) {
      return jsonResponse({ error: "Máximo de 500 logs por sincronização." }, 400);
    }

    const { data: catraca, error: catracaError } = await admin
      .from("organizacao_catracas")
      .select("id, organization_id")
      .eq("device_token", deviceToken)
      .maybeSingle();
    if (catracaError) {
      console.error("Erro ao consultar catraca:", catracaError);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) {
      return jsonResponse({ error: "Dispositivo não autorizado." }, 401);
    }

    const linhas = logs
      .filter((l) => l && RESULTADOS_VALIDOS.has(l.resultado) && l.cpf_consultado)
      .map((l) => ({
        organization_id: catraca.organization_id,
        catraca_id: catraca.id,
        aluno_id: l.aluno_id ?? null,
        cpf_consultado: l.cpf_consultado.replace(/\D/g, ""),
        resultado: l.resultado,
        validado_offline: true,
        created_at: l.ocorrido_em || new Date().toISOString(),
      }));

    if (linhas.length === 0) return jsonResponse({ inseridos: 0 });

    const { error: insertError } = await admin.from("acessos_catraca_logs").insert(linhas);
    if (insertError) {
      console.error("Erro ao inserir logs offline:", insertError);
      return jsonResponse({ error: "Falha ao gravar os logs offline." }, 500);
    }

    return jsonResponse({ inseridos: linhas.length });
  } catch (error) {
    console.error("Erro inesperado em catraca-sincronizar-logs-offline:", error);
    return jsonResponse({ error: "Erro inesperado ao sincronizar logs offline." }, 500);
  }
});

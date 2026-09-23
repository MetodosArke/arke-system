import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GIROS = new Set(["confirmado", "desistencia", "sem_confirmacao"]);

// ARKE® Gateway Local — confirmação física do giro.
//
// "Liberado" não é "entrou": a catraca pode liberar e o aluno desistir na
// frente da borboleta. A iDBlock informa o desfecho pelo Monitor
// (catra_event: TURN LEFT, TURN RIGHT, GIVE UP) e o gateway repassa aqui.
// O registro nasceu com giro 'pendente' em catraca-validar-acesso; esta
// função o fecha, e o gatilho trg_presenca_pela_catraca decide a presença —
// a regra de presença continua num lugar só.
//
// Mesma autenticação das outras funções da catraca: device_token no corpo,
// verify_jwt desligado. E presa ao próprio dispositivo: a atualização exige
// que o registro seja DESTA catraca, então um token vazado não fecha giro
// de outra academia.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload = (await req.json()) as { device_token?: string; log_id?: string; giro?: string };
    const deviceToken = payload.device_token?.trim();
    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    if (!payload.log_id || !payload.giro || !GIROS.has(payload.giro)) {
      return jsonResponse({ error: "Informe log_id e giro (confirmado, desistencia ou sem_confirmacao)." }, 400);
    }

    const { data: catraca } = await admin
      .from("organizacao_catracas")
      .select("id")
      .eq("device_token", deviceToken)
      .maybeSingle();
    if (!catraca) return jsonResponse({ error: "Dispositivo não autorizado." }, 401);

    // Só fecha giro que ainda está pendente: repetição do mesmo aviso (a
    // rede do gateway pode reenviar) não altera um desfecho já registrado.
    const { data, error } = await admin
      .from("acessos_catraca_logs")
      .update({ giro: payload.giro })
      .eq("id", payload.log_id)
      .eq("catraca_id", catraca.id)
      .eq("giro", "pendente")
      .select("id");
    if (error) {
      console.error("Erro ao confirmar giro:", error.code);
      return jsonResponse({ error: "Falha ao registrar o giro." }, 500);
    }

    return jsonResponse({ atualizado: (data ?? []).length });
  } catch (erro) {
    console.error("Erro inesperado em catraca-confirmar-giro:", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

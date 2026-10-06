import { createClient } from "npm:@supabase/supabase-js@2";
import { servir } from "../_shared/servir.ts";

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
const PARCEIROS_VALIDOS = new Set<string>(["wellhub", "totalpass"]);

type CheckinPayload = {
  catraca_id: string;
  parceiro: Parceiro;
  nome_visitante?: string;
};

// Check-in de visitante de agregador (Wellhub/Gympass, TotalPass), que não é
// necessariamente aluno da academia. Sem integração automática com a API dos
// parceiros ainda: a recepção confere o código no app do visitante e
// confirma aqui.
//
// Até 06/10/2026 a função só gravava o registro e respondia "liberado": a
// tela dizia "Catraca liberada!" e a catraca não abria. Agora a regra mora em
// public.checkin_parceiro_externo() (20261373010000), chamada com a sessão de
// quem confirma: registra o check-in e, se a catraca aceita ordem remota,
// manda a liberação pelo canal de ordens do Gateway (a tela acompanha a
// ordem até o fim); senão, a resposta diz o que fazer, sem prometer.
servir("catraca-checkin-parceiro-externo", async (req: Request) => {
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
  if (!supabaseUrl || !anonKey) {
    console.error("catraca-checkin-parceiro-externo: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<CheckinPayload> = await req.json().catch(() => ({}));
    const catracaId = typeof payload.catraca_id === "string" ? payload.catraca_id.trim() : "";
    const parceiro = payload.parceiro;
    const nomeVisitante = typeof payload.nome_visitante === "string" ? payload.nome_visitante.trim() || null : null;

    if (!catracaId) return jsonResponse({ error: "catraca_id é obrigatório." }, 400);
    if (!parceiro || !PARCEIROS_VALIDOS.has(parceiro)) {
      return jsonResponse({ error: "parceiro inválido. Use wellhub ou totalpass." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || typeof claimsData?.claims?.sub !== "string") {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    // Com a sessão de quem confirma: o banco confere o papel pelo auth.uid().
    const { data, error } = await asUser.rpc("checkin_parceiro_externo", {
      _catraca_id: catracaId,
      _parceiro: parceiro,
      _nome_visitante: nomeVisitante,
    });
    if (error) {
      // As mensagens da função são nossas, em português: podem ir para a tela.
      if (error.code === "42501") return jsonResponse({ error: error.message }, 403);
      if (error.code === "P0002") return jsonResponse({ error: error.message }, 404);
      if (error.code === "22023") return jsonResponse({ error: error.message }, 400);
      console.error("catraca-checkin-parceiro-externo: falha no banco", error.code);
      return jsonResponse({ error: "Falha ao registrar o check-in." }, 500);
    }
    return jsonResponse(data);
  } catch (error) {
    console.error("catraca-checkin-parceiro-externo: erro inesperado", error instanceof Error ? error.name : typeof error);
    return jsonResponse({ error: "Erro inesperado ao registrar o check-in." }, 500);
  }
});

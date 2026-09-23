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

    // Heartbeat do Gateway Local. O gateway chama esta função num
    // setInterval de 5 minutos, independente de ter movimento na catraca,
    // então este carimbo é o único sinal de vida confiável do dispositivo:
    // organizacao_catracas.status é cadastro manual e continua 'ativo'
    // mesmo com a unidade desligada há semanas.
    //
    // Sem await e sem bloquear a resposta: se o carimbo falhar, a catraca
    // não pode parar de sincronizar alunos por causa de telemetria.
    void admin
      .from("organizacao_catracas")
      .update({ ultimo_heartbeat_em: new Date().toISOString() })
      .eq("id", catraca.id)
      .then(({ error }) => {
        if (error) console.error("Falha ao registrar heartbeat da catraca", error);
      });

    const { data: alunos, error: alunosError } = await admin
      .from("alunos")
      .select("id, user_id, identificador_catraca")
      .eq("organization_id", catraca.organization_id);
    if (alunosError) {
      console.error("Erro ao listar alunos:", alunosError);
      return jsonResponse({ error: "Falha ao listar alunos." }, 500);
    }

    // A mesma regra do caminho online (aluno_barrado_na_catraca), em lote:
    // situacao_permite_app, com a tolerância de 5 dias do inadimplente e o
    // pausado barrado. O campo continua se chamando "inadimplente" porque é
    // o contrato com gateways já instalados — o sentido agora é "não entra".
    // A tolerância é avaliada na sincronização, então pode atrasar pelo
    // intervalo dela (5 min por padrão); na contingência, é aceitável.
    const { data: barrados, error: barradosError } = await admin.rpc("alunos_barrados_na_catraca", {
      _organization_id: catraca.organization_id,
    });
    if (barradosError) {
      console.error("Erro ao listar alunos barrados:", barradosError);
      return jsonResponse({ error: "Falha ao calcular quem pode entrar." }, 500);
    }
    const alunosBarrados = new Set((barrados ?? []) as string[]);

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
        const identificador = a.identificador_catraca ?? null;

        // Antes isto exigia CPF e descartava o resto. Com liberação por
        // digital o equipamento devolve o identificador dele, não um CPF —
        // e o aluno que só tem biometria cadastrada é justamente quem não
        // pode faltar no cache de contingência. Basta ter uma das duas
        // chaves; sem nenhuma, não há como validar offline.
        if (!cpf && !identificador) return null;

        return {
          aluno_id: a.id,
          cpf,
          identificador_catraca: identificador,
          nome: profile?.full_name ?? "",
          inadimplente: alunosBarrados.has(a.id),
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return jsonResponse({ alunos: lista, sincronizado_em: new Date().toISOString() });
  } catch (error) {
    console.error("Erro inesperado em catraca-sincronizar-alunos:", error);
    return jsonResponse({ error: "Erro inesperado ao sincronizar alunos." }, 500);
  }
});

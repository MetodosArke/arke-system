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
  /** `sincronizado_em` da última sincronização — pede só a diferença. */
  desde?: string;
  /** Força a lista inteira (o Gateway pede quando o hash não bate). */
  completo?: boolean;
};

// ARKE® Gateway Local — alimenta o cache offline do middleware Node.js
// (SQLite/NeDB local) com a lista de alunos ativos da organização, para
// que a catraca continue liberando/bloqueando mesmo sem internet. O
// gateway chama isto a cada 5 minutos. Desde 23/09/2026 devolve só a
// diferença desde a última sincronização, conferida por hash — antes era a
// lista inteira toda vez, e isso era quase todo o tráfego da plataforma.
// Mesmo padrão de autenticação
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

    // Pedido de diferença: o Gateway manda o `sincronizado_em` da última
    // sincronização. Sem ele, ou se for velho demais, vai a lista inteira —
    // uma semana sem sincronizar é caso de reinstalação, não de diferença.
    const desdeTexto = payload.completo ? undefined : payload.desde;
    const desde = desdeTexto ? new Date(desdeTexto) : null;
    const diferenca =
      !!desde && !Number.isNaN(desde.getTime()) && Date.now() - desde.getTime() < 7 * 24 * 3600_000;
    // Dois minutos de sobreposição: uma linha gravada durante a sincronização
    // anterior não pode cair no vão entre as duas. Repetir é inofensivo — o
    // Gateway aplica por aluno_id.
    const agora = new Date();
    const aPartirDe = diferenca ? new Date(desde!.getTime() - 120_000).toISOString() : null;

    const [{ data: linhas, error: erroLinhas }, { data: hash, error: erroHash }] = await Promise.all([
      admin.rpc("alunos_catraca", { _organization_id: catraca.organization_id, _desde: aPartirDe }),
      admin.rpc("alunos_catraca_hash", { _organization_id: catraca.organization_id }),
    ]);
    if (erroLinhas || erroHash) {
      console.error("Erro ao montar a sincronização:", (erroLinhas ?? erroHash)?.code);
      return jsonResponse({ error: "Falha ao listar alunos." }, 500);
    }

    type Linha = {
      aluno_id: string;
      cpf: string;
      identificador_catraca: string | null;
      nome: string;
      inadimplente: boolean;
      remover: boolean;
    };
    const todas = (linhas ?? []) as Linha[];
    const semRemover = ({ remover: _r, ...resto }: Linha) => resto;

    // `ids_hash` é a impressão digital do conjunto que o cache deve ter. O
    // Gateway aplica a diferença, calcula o hash do próprio cache e, se não
    // bater, pede a lista inteira. É o que cobre exclusão de aluno — que
    // não deixa linha para aparecer na diferença — e qualquer divergência
    // que ninguém previu.
    return jsonResponse({
      completo: !diferenca,
      alunos: todas.filter((l) => !l.remover).map(semRemover),
      remover: diferenca ? todas.filter((l) => l.remover).map((l) => l.aluno_id) : [],
      ids_hash: hash,
      sincronizado_em: agora.toISOString(),
    });
  } catch (error) {
    console.error("Erro inesperado em catraca-sincronizar-alunos:", error);
    return jsonResponse({ error: "Erro inesperado ao sincronizar alunos." }, 500);
  }
});

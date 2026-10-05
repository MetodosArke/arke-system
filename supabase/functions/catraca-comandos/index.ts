import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hashDoTokenCatraca } from "../_shared/tokenCatraca.ts";
import { servir } from "../_shared/servir.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mais que isso a conexão do Gateway começa a esbarrar em proxies e no limite da função. */
const ESPERA_MAXIMA_MS = 25_000;
const INTERVALO_CONSULTA_MS = 1_500;

type Resultado = { id?: string; sucesso?: boolean; resultado?: unknown; erro?: string };

type Payload = {
  device_token?: string;
  /** Resultados dos comandos que o Gateway executou desde a última chamada. */
  resultados?: Resultado[];
  /** Estado do Gateway: versão, contingência, fila offline, equipamentos, capacidades. */
  telemetria?: Record<string, unknown>;
  /** Quanto segurar a resposta esperando ordem nova (escuta longa). */
  aguardar_ms?: number;
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A versão mínima do Gateway (Visão Master → Configurações). Lida no máximo a
 * cada 5 minutos por instância: são umas 100 mil chamadas por Gateway por mês,
 * e o valor quase nunca muda. Falha na leitura devolve a última conhecida, ou
 * nenhuma: o aviso de versão não pode derrubar o canal.
 */
let versaoMinima: { valor: string | null; lidaEm: number } | null = null;
async function lerVersaoMinima(admin: SupabaseClient): Promise<string | null> {
  if (versaoMinima && Date.now() - versaoMinima.lidaEm < 5 * 60_000) return versaoMinima.valor;
  const { data, error } = await admin.from("plataforma_textos").select("valor").eq("chave", "gateway_versao_minima").maybeSingle();
  if (error) {
    console.error("catraca-comandos: versão mínima indisponível", error.code);
    return versaoMinima?.valor ?? null;
  }
  versaoMinima = { valor: (data?.valor as string | null)?.trim() || null, lidaEm: Date.now() };
  return versaoMinima.valor;
}

/**
 * As fotos do rosto das ordens entregues agora (no máximo 10 ordens por
 * entrega). Dado biométrico: nunca vai para log, nem o tamanho.
 */
async function fotosDoRosto(
  admin: SupabaseClient,
  comandos: { tipo: string; parametros: Record<string, unknown> | null }[]
): Promise<Map<string, string>> {
  const ids = comandos
    .filter((c) => c.tipo === "enviar_foto_rosto")
    .map((c) => String(c.parametros?.foto_id ?? ""))
    .filter((id) => UUID.test(id));
  const fotos = new Map<string, string>();
  if (ids.length === 0) return fotos;
  const { data, error } = await admin.from("fotos_rosto_pendentes").select("id, foto").in("id", ids);
  if (error) console.error("catraca-comandos: fotos do rosto indisponíveis", error.code);
  for (const f of (data ?? []) as { id: string; foto: string }[]) fotos.set(f.id, f.foto);
  return fotos;
}

// ARKE® Gateway Local — canal de ida e volta com a nuvem (versão 1.0).
//
// Até aqui só o Gateway falava: validava acesso, sincronizava alunos, subia
// o que decidiu offline. A nuvem não tinha como mandar nada de volta — nem
// "sincronize agora", nem "apague este aluno do equipamento", que a LGPD
// exige depois da revogação biométrica.
//
// Escuta longa, e não o Gateway perguntando a cada poucos segundos nem uma
// porta aberta na academia. A chamada fica esperando até 25 s por uma ordem
// e volta assim que ela existe; sem ordem, volta vazia e o Gateway chama de
// novo. A recepção cadastra a digital com o aluno na frente e a ordem chega
// em ~1 s, com umas 100 mil chamadas por Gateway por mês — e quem abre a
// conexão continua sendo o Gateway, então a rede da academia não muda.
//
// Cada chamada leva também:
//   * a telemetria (registrar_telemetria_gateway guarda o estado, o histórico
//     e o sinal de vida — que assim passa de 5 min para ~20 s de precisão);
//   * os resultados das ordens executadas (concluir_comando_gateway aplica os
//     efeitos: identificador do aluno, registro da liberação, fim da remoção).
//
// Mesma autenticação das outras funções da catraca: device_token no corpo,
// verify_jwt desligado, e tudo preso ao próprio dispositivo.
servir("catraca-comandos", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload = (await req.json()) as Payload;
    const deviceToken = payload.device_token?.trim();
    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    const tokenHash = await hashDoTokenCatraca(deviceToken);
    if (!tokenHash) return jsonResponse({ error: "Dispositivo não autorizado." }, 401);

    const { data: catraca, error: erroCatraca } = await admin
      .from("organizacao_catracas")
      .select("id, status")
      .eq("device_token_hash", tokenHash)
      .maybeSingle();
    if (erroCatraca) {
      console.error("catraca-comandos: falha ao validar dispositivo", erroCatraca.code);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) return jsonResponse({ error: "Dispositivo não autorizado." }, 401);

    // Telemetria antes de tudo: é ela que diz à nuvem que o Gateway está vivo,
    // e uma falha aqui não pode impedir a entrega de ordens.
    if (payload.telemetria && typeof payload.telemetria === "object") {
      const { error } = await admin.rpc("registrar_telemetria_gateway", {
        _catraca_id: catraca.id,
        _tel: payload.telemetria,
      });
      if (error) console.error("catraca-comandos: telemetria não registrada", error.code);
    }

    // Resultados: um por comando, só os deste dispositivo (a função confere).
    const resultados = Array.isArray(payload.resultados) ? payload.resultados.slice(0, 20) : [];
    for (const r of resultados) {
      if (!r?.id || !UUID.test(r.id)) continue;
      const resultado =
        r.resultado && typeof r.resultado === "object" && JSON.stringify(r.resultado).length <= 8_000
          ? r.resultado
          : null;
      const { error } = await admin.rpc("concluir_comando_gateway", {
        _catraca_id: catraca.id,
        _comando_id: r.id,
        _sucesso: r.sucesso === true,
        _resultado: resultado,
        _erro: typeof r.erro === "string" ? r.erro.slice(0, 500) : null,
      });
      if (error) console.error("catraca-comandos: resultado não registrado", error.code);
    }

    // Catraca desativada no ARKE não recebe ordem nova; a telemetria acima
    // continua valendo para o painel mostrar que o equipamento está ligado.
    const versao_minima = await lerVersaoMinima(admin);
    if (catraca.status !== "ativo") {
      return jsonResponse({ comandos: [], servidor_em: new Date().toISOString(), versao_minima });
    }

    const espera = Math.max(0, Math.min(Number(payload.aguardar_ms) || 0, ESPERA_MAXIMA_MS));
    const limite = Date.now() + espera;
    for (;;) {
      const { data: comandos, error } = await admin.rpc("entregar_comandos_gateway", { _catraca_id: catraca.id });
      if (error) {
        console.error("catraca-comandos: falha ao buscar ordens", error.code);
        return jsonResponse({ error: "Falha ao buscar ordens." }, 500);
      }
      if ((comandos ?? []).length > 0 || Date.now() + INTERVALO_CONSULTA_MS > limite || req.signal.aborted) {
        const lista = (comandos ?? []) as { id: string; tipo: string; parametros: Record<string, unknown> | null }[];
        const fotos = await fotosDoRosto(admin, lista);
        return jsonResponse({
          comandos: lista.map((c) => ({
            id: c.id,
            tipo: c.tipo,
            // A foto do rosto vai junto só na entrega: a ordem guarda o
            // número dela, e a foto mora em fotos_rosto_pendentes, que
            // ninguém lê pela API. Foto que já saiu (expirou, foi trocada)
            // vai como null, e o Gateway responde que ela não está mais lá.
            parametros:
              c.tipo === "enviar_foto_rosto"
                ? { ...(c.parametros ?? {}), foto: fotos.get(String(c.parametros?.foto_id ?? "")) ?? null }
                : c.parametros,
          })),
          servidor_em: new Date().toISOString(),
          versao_minima,
        });
      }
      await dormir(INTERVALO_CONSULTA_MS);
    }
  } catch (erro) {
    console.error("catraca-comandos: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

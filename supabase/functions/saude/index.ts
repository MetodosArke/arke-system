import { createClient } from "npm:@supabase/supabase-js@2";
import { servir } from "../_shared/servir.ts";

// Saúde da plataforma para o monitor externo (o UptimeRobot, de 5 em 5
// minutos).
//
// O alerta de rotinas e o Vigia moram dentro do Supabase: se o banco, as edge
// functions ou o pg_cron param, quem avisaria parou junto. Esta função é o
// ponto que alguém de fora consegue perguntar. Responde 200 só com o banco
// respondendo, alguma rotina rodando nos últimos 15 minutos e o alerta de
// rotinas em dia; qualquer outra coisa é 503.
//
// Pública e sem dado: devolve três booleanos. A resposta fica guardada 30 s
// por instância, para uma enxurrada de chamadas não virar consulta ao banco.

const GUARDA_MS = 30_000;
const PRAZO_BANCO_MS = 5_000;
const cabecalhos = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

type Verificacao = { banco: boolean; rotinas: boolean; alertas: boolean; verificado_em: string };
let guardada: { verificacao: Verificacao; em: number } | null = null;

async function verificar(): Promise<Verificacao> {
  const resultado: Verificacao = { banco: false, rotinas: false, alertas: false, verificado_em: new Date().toISOString() };
  const url = Deno.env.get("SUPABASE_URL");
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chave) return resultado;
  const admin = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (entrada, init) => fetch(entrada, { ...init, signal: AbortSignal.timeout(PRAZO_BANCO_MS) }) },
  });
  const { data, error } = await admin.rpc("saude_plataforma");
  if (error || !data) {
    console.error("saude: banco sem resposta", error?.code ?? "sem dados");
    return resultado;
  }
  const d = data as { rotinas?: unknown; alertas?: unknown };
  return { ...resultado, banco: true, rotinas: d.rotinas === true, alertas: d.alertas === true };
}

servir("saude", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cabecalhos });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Use GET." }), { status: 405, headers: cabecalhos });
  }
  if (!guardada || Date.now() - guardada.em > GUARDA_MS) {
    guardada = { verificacao: await verificar(), em: Date.now() };
  }
  const v = guardada.verificacao;
  const ok = v.banco && v.rotinas && v.alertas;
  return new Response(JSON.stringify({ status: ok ? "ok" : "falhou", ...v }), {
    status: ok ? 200 : 503,
    headers: cabecalhos,
  });
});

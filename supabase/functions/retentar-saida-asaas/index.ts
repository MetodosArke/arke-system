import { createClient } from "npm:@supabase/supabase-js@2";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { retentarPendentes } from "../_shared/saidaAsaas.ts";
import { servir } from "../_shared/servir.ts";

// A nova tentativa de anonimizar no Asaas o cliente do aluno que saiu
// (`asaas_saida_pendente`, migration 20261377010000). A saída do aluno não
// espera o Asaas: quando ele falha, a pendência fica, e esta rotina tenta de
// novo de hora em hora até dar certo. Só o cron chama, com o token do Vault.

const NOME = "retentar-saida-asaas";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

servir("retentar-saida-asaas", async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const doCron = token ? !!(await admin.rpc("conferir_token_alerta_rotinas", { _token: token })).data : false;
  if (!doCron) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    // Pendência que continua pendente não derruba a rotina: ela fica na
    // tabela com a tentativa contada. A rotina só falha se não conseguiu olhar.
    const r = await retentarPendentes(admin, (n) => Deno.env.get(n));
    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, ...r });
  } catch (e) {
    console.error(`${NOME}: erro inesperado`, descreverErro(e));
    await registrarExecucao(admin, NOME, false, descreverErro(e));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

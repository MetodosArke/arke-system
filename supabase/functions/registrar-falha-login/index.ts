import { createClient } from "npm:@supabase/supabase-js@2";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { servir } from "../_shared/servir.ts";
import { lerFalhaDeLogin } from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

// Mesmo hash com pimenta da matrícula pública: o IP e o e-mail são dado
// pessoal, e sem pimenta o hash de um IPv4 ou de um e-mail conhecido se
// reverte por tentativa.
async function hashComPimenta(texto: string, pimenta: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pimenta}:${texto}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// A tentativa de entrar que falhou, para a trilha de 6 meses (contrato BaaS com
// o Asaas, 14/10/2026; migration 20261445010000). A tela de entrar chama depois
// do erro do Auth, com o e-mail digitado e o código do erro; a senha não vem.
// O banco guarda a conta pelo id (ou só o hash do e-mail, quando a conta não
// existe), o hash do IP e o código. A resposta é a mesma para conta que existe
// e que não existe.
//
// ponytail: registra a falha que passa pelo app; a tentativa feita direto na
// API do Auth fica só nos logs do Supabase. Fechar isso pede o gancho de
// verificação de senha do Auth (plano Team).
servir("registrar-falha-login", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);

  const falha = lerFalhaDeLogin(await req.json().catch(() => null));
  if (!falha) return jsonResponse({ error: "Pedido inválido." }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const ip = ipDoCliente(req);
  const ipHash = ip ? await hashComPimenta(ip, serviceRoleKey) : null;

  // Público por desenho: o freio segura quem enche a trilha de falha inventada.
  const freio = [
    ...(ipHash ? [{ chave: `falha-login:ip:${ipHash}`, limite: 60, janelaSeg: 10 * 60 }] : []),
    { chave: "falha-login:total", limite: 3000, janelaSeg: 60 * 60 },
  ];
  if (!(await dentroDoFreio(admin, freio))) return jsonResponse({ error: MENSAGEM_FREIO }, 429);

  const { error } = await admin.rpc("registrar_falha_login", {
    _email: falha.email,
    _email_hash: await hashComPimenta(`email:${falha.email}`, serviceRoleKey),
    _ip_hash: ipHash,
    _motivo: falha.motivo,
  });
  if (error) {
    console.error("registrar-falha-login: gravar", resumoDoErro(error));
    return jsonResponse({ error: "Não foi possível registrar agora." }, 500);
  }
  return jsonResponse({ ok: true });
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { verificarCaptcha } from "../_shared/captcha.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { servir } from "../_shared/servir.ts";
import { avisarComercial } from "../lead-site/avisarComercial.ts";
import { validarPesquisa, VERSAO_QUESTIONARIO } from "./questionario.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** O `origem_detalhe` do contato, no aviso ao comercial: o mesmo texto que `registrar_pesquisa_mercado` grava. */
const ORIGEM_DA_PESQUISA = "Pesquisa de mercado";

function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

// O IP é dado pessoal: só o hash com pimenta, como na matrícula pública.
async function hashDoIp(ip: string, pimenta: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pimenta}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// A pesquisa de mercado do site (`/pesquisa`, 15/10/2026; migration
// 20261446010000). Pública (verify_jwt = false), com freio por IP e no total,
// captcha quando TURNSTILE_SECRET_KEY existe e o campo-isca do formulário de
// contato. Cada resposta é conferida contra a lista fechada do questionário
// (`questionario.ts`, o mesmo módulo da tela) antes de gravar. A resposta, o
// e-mail autorizado e o contato de quem quer conhecer o ArkeFit entram juntos,
// numa transação só (`registrar_pesquisa_mercado`); o contato recebe o mesmo
// aviso ao comercial do formulário da página de vendas, e a Letícia o atende
// como qualquer pedido do site.
servir("pesquisa-mercado", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const ip = ipDoCliente(req);
  const ipHash = ip ? await hashDoIp(ip, serviceRoleKey) : null;
  // Folgado: uma academia com a equipe inteira respondendo na mesma rede passa.
  const freio = [
    ...(ipHash ? [{ chave: `pesquisa:ip:${ipHash}`, limite: 20, janelaSeg: 60 * 60 }] : []),
    { chave: "pesquisa:total", limite: 600, janelaSeg: 60 * 60 },
  ];
  if (!(await dentroDoFreio(admin, freio))) return jsonResponse({ error: MENSAGEM_FREIO }, 429);

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Campo-isca: invisível para gente, preenchido por robô. Responde como se
  // tivesse dado certo, para o robô não aprender a desviar.
  if (typeof corpo.website === "string" && corpo.website.trim()) return jsonResponse({ ok: true });

  const validacao = validarPesquisa(corpo);
  if (!validacao.ok) {
    return jsonResponse({ error: validacao.erro, pergunta: validacao.pergunta }, "versaoAntiga" in validacao ? 409 : 400);
  }

  const segredoCaptcha = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (segredoCaptcha) {
    const captcha = await verificarCaptcha(typeof corpo.captcha_token === "string" ? corpo.captcha_token : undefined, ip, segredoCaptcha);
    if (captcha === "recusado") {
      return jsonResponse({ error: "Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo." }, 400);
    }
  }

  const { respostas, contato } = validacao;
  const { data: leadId, error } = await admin.rpc("registrar_pesquisa_mercado", {
    _versao: VERSAO_QUESTIONARIO,
    _respostas: respostas,
    _email: contato?.email ?? null,
    _resultado: contato?.resultado ?? false,
    _conhecer: contato?.conhecer ?? false,
    _nome: contato?.nome ?? null,
    _academia: contato?.academia ?? null,
    _ip_hash: ipHash,
  });
  if (error) {
    console.error("pesquisa-mercado: gravar", resumoDoErro(error));
    return jsonResponse({ error: "Não foi possível enviar agora. Tente de novo em instantes." }, 500);
  }

  if (typeof leadId === "string" && contato?.conhecer && contato.nome && contato.academia) {
    await avisarComercial(
      admin,
      {
        nome: contato.nome,
        academia: contato.academia,
        email: contato.email,
        telefone: null,
        cidade: null,
        uf: null,
        alunos_faixa: null,
        sistema_atual: null,
        mensagem: null,
        origem_detalhe: ORIGEM_DA_PESQUISA,
      },
      leadId,
    );
  }

  return jsonResponse({ ok: true });
});

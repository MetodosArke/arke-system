import { createClient } from "npm:@supabase/supabase-js@2";
import { verificarCaptcha } from "../_shared/captcha.ts";
import { emailDoLead, validarLead } from "./validar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Formulário da página de vendas (arkefit.com.br). Endpoint público
// (verify_jwt = false) com as travas da matrícula pública: limite por IP
// (as funções de matricula_publica_tentativas), captcha Turnstile quando
// TURNSTILE_SECRET_KEY existe, e um campo-isca que robô preenche e gente não
// vê. Grava em `leads_site` e avisa o e-mail do comercial (plataforma_textos
// `comercial_email`; sem ele, os Super Admins).
const MUITAS_TENTATIVAS = "Muitas tentativas a partir desta rede. Aguarde alguns minutos e tente de novo.";
const POR_IP_POR_DIA = 5;

function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

// IP é dado pessoal: só o hash com pimenta (a mesma da matrícula pública).
async function hashDoIp(ip: string, pimenta: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pimenta}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const ip = ipDoCliente(req);
  const ipHash = ip ? await hashDoIp(ip, serviceRoleKey) : null;
  if (ipHash) {
    const { data, error } = await admin.rpc("registrar_tentativa_matricula", { _ip_hash: ipHash });
    if (!error && data === null) return jsonResponse({ error: MUITAS_TENTATIVAS }, 429);
    if (error) console.error("lead-site: limitador indisponível, seguindo sem ele", error.code);
  }

  try {
    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Campo-isca: invisível para gente, preenchido por robô. Responde como se
    // tivesse dado certo, para o robô não aprender a desviar.
    if (typeof corpo.website === "string" && corpo.website.trim()) return jsonResponse({ ok: true });

    const validacao = validarLead(corpo);
    if (!validacao.ok) return jsonResponse({ error: validacao.erro }, 400);

    const segredoCaptcha = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (segredoCaptcha) {
      const captcha = await verificarCaptcha(typeof corpo.captcha_token === "string" ? corpo.captcha_token : undefined, ip, segredoCaptcha);
      if (captcha === "recusado") {
        return jsonResponse({ error: "Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo." }, 400);
      }
    }

    if (ipHash) {
      const { count } = await admin
        .from("leads_site")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
      if ((count ?? 0) >= POR_IP_POR_DIA) return jsonResponse({ error: MUITAS_TENTATIVAS }, 429);
    }

    const { data: lead, error: erroGravar } = await admin
      .from("leads_site")
      .insert({ ...validacao.lead, ip_hash: ipHash })
      .select("id")
      .single();
    if (erroGravar || !lead) {
      console.error("lead-site: falha ao gravar", erroGravar?.code);
      return jsonResponse({ error: "Não foi possível enviar agora. Tente de novo em instantes." }, 500);
    }

    // O aviso por e-mail é complemento: o contato já está salvo e aparece na
    // Visão Master mesmo que o envio falhe.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const { data: config } = await admin.from("plataforma_textos").select("valor").eq("chave", "comercial_email").maybeSingle();
      let destino = (config?.valor ?? "").trim() ? [String(config!.valor).trim()] : [];
      if (!destino.length) {
        const { data: sa } = await admin.rpc("emails_superadmin");
        destino = ((sa ?? []) as unknown[]).map((l) => (typeof l === "string" ? l : (l as { email?: string }).email ?? "")).filter(Boolean);
      }
      if (destino.length) {
        const { assunto, html } = emailDoLead(validacao.lead, `${siteUrl}/#/superadmin/contatos`);
        try {
          const envio = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: Deno.env.get("EMAIL_SITE_FROM") ?? "ARKE <site@arkefit.com.br>",
              to: destino,
              reply_to: validacao.lead.email,
              subject: assunto,
              html,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (envio.ok) await admin.from("leads_site").update({ email_enviado_em: new Date().toISOString() }).eq("id", lead.id);
          else console.error("lead-site: Resend respondeu", envio.status);
        } catch (e) {
          console.error("lead-site: falha no envio do e-mail", e instanceof Error ? e.name : typeof e);
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (erro) {
    console.error("lead-site: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

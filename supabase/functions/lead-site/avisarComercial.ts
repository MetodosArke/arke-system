import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { cabecalhosDoResend, chaveDeIdempotencia, envioAceito } from "../_shared/idempotenciaEmail.ts";
import { emailDoLead, type Lead } from "./validar.ts";

/**
 * Avisa o comercial do contato novo do site: o e-mail de `plataforma_textos`
 * `comercial_email` (sem ele, os Super Admins). Responder ao e-mail responde
 * para o contato. É complemento: o contato já está salvo e aparece na Visão
 * Master mesmo que o envio falhe. O formulário da página de vendas
 * (`lead-site`) e a pesquisa de mercado (`pesquisa-mercado`) passam por aqui.
 */
export async function avisarComercial(admin: SupabaseClient, lead: Lead, leadId: string): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";

  const { data: config } = await admin.from("plataforma_textos").select("valor").eq("chave", "comercial_email").maybeSingle();
  let destino = (config?.valor ?? "").trim() ? [String(config!.valor).trim()] : [];
  if (!destino.length) {
    const { data: sa } = await admin.rpc("emails_superadmin");
    destino = ((sa ?? []) as unknown[]).map((l) => (typeof l === "string" ? l : (l as { email?: string }).email ?? "")).filter(Boolean);
  }
  if (!destino.length) return;

  const { assunto, html } = emailDoLead(lead, `${siteUrl}/#/superadmin/comercial`);
  try {
    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      // Um aviso por contato.
      headers: cabecalhosDoResend(resendKey, chaveDeIdempotencia("lead-site", leadId)),
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_SITE_FROM") ?? "ARKE <site@arkefit.com.br>",
        to: destino,
        reply_to: lead.email,
        subject: assunto,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (envioAceito(envio.status)) await admin.from("leads_comerciais").update({ email_enviado_em: new Date().toISOString() }).eq("id", leadId);
    else console.error("avisarComercial: Resend respondeu", envio.status);
  } catch (e) {
    console.error("avisarComercial: falha no envio do e-mail", e instanceof Error ? e.name : typeof e);
  }
}

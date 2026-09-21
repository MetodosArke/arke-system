import { createClient } from "npm:@supabase/supabase-js@2";
import { montarEmail, type Item } from "./email.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Avisa por e-mail os Super Admins quando uma rotina do pg_cron entra em
// problema, continua nele (lembrete a cada 24 h) ou se recupera. A faixa
// vermelha da Visão Master só avisa quem abre a tela; isto avisa no fim de
// semana também.
//
// Chamada de hora em hora pelo cron `arke-alerta-rotinas`, autenticada pelo
// token que o banco guarda no Vault (header x-alerta-token) — o mesmo desenho
// da reconciliação com o Asaas. Quem decide o que avisar é
// public.rotinas_para_alertar(); aqui só se envia e, depois do envio, se
// registra o aviso. Nessa ordem: se o e-mail falha, o aviso não é marcado como
// dado e sai de novo na hora seguinte.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    console.error("alertar-rotinas: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token
    ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token })
    : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  const { data: itens, error: erroItens } = await admin.rpc("rotinas_para_alertar");
  if (erroItens) {
    console.error("alertar-rotinas: falha ao avaliar", erroItens.code);
    return jsonResponse({ error: "Falha ao avaliar as rotinas." }, 500);
  }
  if (!itens?.length) return jsonResponse({ ok: true, enviados: 0 });

  const { data: destinatarios } = await admin.rpc("emails_superadmin");
  const emails = (destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
  if (!emails.length) {
    console.error("alertar-rotinas: nenhum Super Admin com e-mail");
    return jsonResponse({ error: "Nenhum destinatário." }, 500);
  }

  const { assunto, html, texto } = montarEmail(itens as Item[], `${siteUrl}/#/superadmin`);
  const envio = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>",
      to: emails,
      subject: assunto,
      html,
      text: texto,
    }),
  });
  if (!envio.ok) {
    // Não marca como avisado: sai de novo na próxima hora.
    console.error("alertar-rotinas: Resend recusou", envio.status);
    return jsonResponse({ error: "Falha ao enviar o e-mail." }, 502);
  }

  const { error: erroRegistro } = await admin.rpc("registrar_alerta_rotinas", { _itens: itens });
  if (erroRegistro) console.error("alertar-rotinas: e-mail enviado, mas falhou ao registrar", erroRegistro.code);

  return jsonResponse({ ok: true, enviados: itens.length });
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { montarEmailResumo, type Resumo } from "./email.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "vigia-resumo";

// Resumo diário do Vigia para a ArkeFit, às 8h de Brasília (cron
// `arke-vigia-resumo`). Sai mesmo num dia sem ocorrência nenhuma: no modo
// sombra, "rodou 288 vezes e não viu nada" é informação — é o que distingue
// um dia calmo de um Vigia parado. Desligado o Vigia, o resumo não sai.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("vigia-resumo: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    if (!resendKey) {
      await registrarExecucao(admin, NOME, false, "RESEND_API_KEY ausente");
      return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
    }
    const { data: resumo, error } = await admin.rpc("vigia_resumo_interno", { _horas: 24 });
    if (error || !resumo) {
      console.error("vigia-resumo: falha ao montar o resumo", error?.code);
      await registrarExecucao(admin, NOME, false, `vigia_resumo_interno: ${error?.code ?? "vazio"}`);
      return jsonResponse({ error: "Falha ao montar o resumo." }, 500);
    }
    if (!(resumo as Resumo).ativo) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, enviado: false, motivo: "Vigia desligado" });
    }

    const { data: dest } = await admin.rpc("emails_superadmin");
    const emails = (dest ?? []).map((d: { email: string }) => d.email).filter(Boolean);
    if (!emails.length) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, enviado: false, motivo: "sem destinatário" });
    }

    const m = montarEmailResumo(resumo as Resumo, siteUrl);
    const de = Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from: de, to: emails, subject: m.assunto, html: m.html, text: m.texto }),
    });
    // Só o status vai para log: a resposta do Resend ecoa os endereços.
    if (!r.ok) {
      console.error("vigia-resumo: Resend recusou", r.status);
      await registrarExecucao(admin, NOME, false, `Resend recusou HTTP ${r.status}`);
      return jsonResponse({ error: "Falha no envio." }, 502);
    }

    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, enviado: true, assunto: m.assunto });
  } catch (erro) {
    console.error("vigia-resumo: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

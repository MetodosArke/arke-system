import { createClient } from "npm:@supabase/supabase-js@2";
import { montarEmail, type Item } from "./email.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "alertar-rotinas";

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
//
// Desde a versão 1.0 registra também o próprio desfecho
// (registrar_execucao_agendada): se esta função quebrar, é a faixa da Visão
// Master que avisa — o e-mail seria mandado justamente por ela.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("alertar-rotinas: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token
    ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token })
    : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  // Daqui para baixo toda saída registra o desfecho.
  const falha = async (status: number, publico: string, interno: string) => {
    await registrarExecucao(admin, NOME, false, interno);
    return jsonResponse({ error: publico }, status);
  };

  try {
    if (!resendKey) return await falha(500, "Configuração do servidor incompleta.", "RESEND_API_KEY ausente");

    const { data: itens, error: erroItens } = await admin.rpc("rotinas_para_alertar");
    if (erroItens) {
      console.error("alertar-rotinas: falha ao avaliar", erroItens.code);
      return await falha(500, "Falha ao avaliar as rotinas.", `rotinas_para_alertar: ${erroItens.code}`);
    }
    if (!itens?.length) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, enviados: 0 });
    }

    const { data: destinatarios } = await admin.rpc("emails_superadmin");
    const emails = (destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
    if (!emails.length) {
      console.error("alertar-rotinas: nenhum Super Admin com e-mail");
      return await falha(500, "Nenhum destinatário.", "nenhum Super Admin com e-mail");
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
      return await falha(502, "Falha ao enviar o e-mail.", `Resend recusou HTTP ${envio.status}`);
    }

    const { error: erroRegistro } = await admin.rpc("registrar_alerta_rotinas", { _itens: itens });
    if (erroRegistro) console.error("alertar-rotinas: e-mail enviado, mas falhou ao registrar", erroRegistro.code);

    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, enviados: itens.length });
  } catch (erro) {
    // Rede fora no meio do envio, resposta inesperada: sem isto, a exceção
    // virava 500 genérico do runtime e ninguém ficava sabendo.
    console.error("alertar-rotinas: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return await falha(500, "Erro inesperado.", descreverErro(erro));
  }
});

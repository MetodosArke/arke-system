import { createClient } from "npm:@supabase/supabase-js@2";
import { montarLembrete } from "./email.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "lembrete-onboarding";

// Lembrete por e-mail para academia com o onboarding parado há 3 dias.
//
// Chamada uma vez por dia pelo cron `arke-lembrete-onboarding`, autenticada
// pelo token que o banco guarda no Vault (header x-lembrete-token), no desenho
// do alerta de rotinas. Quem decide a quem lembrar é
// public.organizacoes_onboarding_parado() (a cada 3 dias, no máximo 5 vezes);
// aqui só se envia e, depois do envio, se registra — se o e-mail falha, o
// lembrete sai de novo no dia seguinte.
//
// Cada envio tem o próprio tratamento de erro: uma falha de rede no meio não
// pode deixar sem lembrete as academias que vinham depois na lista. E o
// desfecho do dia vai para registrar_execucao_agendada — envio recusado conta
// como falha, porque é exatamente o caso em que ninguém recebe nada.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("lembrete-onboarding: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const token = req.headers.get("x-lembrete-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_lembrete_onboarding", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    if (!resendKey) {
      await registrarExecucao(admin, NOME, false, "RESEND_API_KEY ausente");
      return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
    }

    const { data: academias, error } = await admin.rpc("organizacoes_onboarding_parado");
    if (error) {
      console.error("lembrete-onboarding: falha ao listar", error.code);
      await registrarExecucao(admin, NOME, false, `organizacoes_onboarding_parado: ${error.code}`);
      return jsonResponse({ error: "Falha ao listar as academias." }, 500);
    }

    let enviados = 0;
    let falhas = 0;
    let ultimaFalha = "";
    for (const a of (academias ?? []) as { organization_id: string; nome: string; email: string | null; pendentes: string | null }[]) {
      if (!a.email) continue;
      try {
        const { assunto, html, texto } = montarLembrete(a.nome, a.pendentes, `${siteUrl}/#/admin/onboarding`);
        const envio = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_ONBOARDING_FROM") ?? "ArkeFit <ola@arkefit.com.br>",
            to: [a.email],
            subject: assunto,
            html,
            text: texto,
          }),
        });
        if (!envio.ok) {
          console.error("lembrete-onboarding: Resend recusou", envio.status);
          falhas++;
          ultimaFalha = `Resend recusou HTTP ${envio.status}`;
          continue;
        }
        const { error: erroRegistro } = await admin.rpc("registrar_lembrete_onboarding", { _organization_id: a.organization_id });
        if (erroRegistro) console.error("lembrete-onboarding: enviado, mas falhou ao registrar", erroRegistro.code);
        enviados++;
      } catch (erro) {
        console.error("lembrete-onboarding: falha num envio", erro instanceof Error ? erro.name : typeof erro);
        falhas++;
        ultimaFalha = descreverErro(erro);
      }
    }

    await registrarExecucao(admin, NOME, falhas === 0, falhas ? `${falhas} envio(s) sem sucesso; o último: ${ultimaFalha}` : undefined);
    return jsonResponse({ ok: falhas === 0, enviados, falhas });
  } catch (erro) {
    console.error("lembrete-onboarding: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

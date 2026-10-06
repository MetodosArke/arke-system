import { createClient } from "npm:@supabase/supabase-js@2";
import { chaveDoEnvio, montarEmailArkeFit, montarEmailGestor, separarEnvios, type AvisoCatraca } from "./email.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { servir } from "../_shared/servir.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "alertar-catracas";

// Aviso de catraca fora do ar, para a ArkeFit e para o gestor de cada
// academia (decisão do responsável, 23/09/2026). Chamada de 2 em 2 minutos
// pelo cron `arke-alerta-catracas`, com o mesmo token do alerta de rotinas;
// quem decide o que avisar é public.catracas_a_avisar() — 10 minutos sem
// sinal, das 6h às 23h, lembrete a cada 24 h e "voltou" quando voltar.
//
// Cada destinatário tem o próprio "já avisei" (06/10/2026): a ArkeFit recebe
// um e-mail com tudo, cada academia um com as catracas dela, e cada um só é
// registrado quando o e-mail dele saiu. Antes o registro era um só, feito
// pelo e-mail da ArkeFit: o gestor cujo e-mail falhou ficava como avisado, e
// a falha do da ArkeFit fazia os gestores receberem o mesmo aviso a cada 2
// minutos. O envio leva chave de idempotência: se o registro falhar depois
// do envio, a passada seguinte não entrega de novo.
servir("alertar-catracas", async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("alertar-catracas: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token
    ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token })
    : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  const de = Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>";
  const enviar = async (para: string[], m: { assunto: string; html: string; texto: string }, chave: string) => {
    const r = await fetch("https://api.resend.com/emails", {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": chave },
      body: JSON.stringify({ from: de, to: para, subject: m.assunto, html: m.html, text: m.texto }),
    });
    // Só o status vai para log: a resposta do Resend ecoa os endereços.
    if (!r.ok) throw new Error(`Resend recusou HTTP ${r.status}`);
  };

  try {
    if (!resendKey) {
      await registrarExecucao(admin, NOME, false, "RESEND_API_KEY ausente");
      return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
    }

    const { data: itens, error } = await admin.rpc("catracas_a_avisar");
    if (error) {
      console.error("alertar-catracas: falha ao avaliar", error.code);
      await registrarExecucao(admin, NOME, false, `catracas_a_avisar: ${error.code}`);
      return jsonResponse({ error: "Falha ao avaliar as catracas." }, 500);
    }
    const lista = (itens ?? []) as AvisoCatraca[];
    if (!lista.length) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, avisos: 0 });
    }

    let falhas = 0;
    let ultimaFalha = "";
    let enviados = 0;
    for (const envio of separarEnvios(lista)) {
      try {
        const { data: dest, error: erroDest } =
          envio.destinatario === "arkefit"
            ? await admin.rpc("emails_superadmin")
            : await admin.rpc("emails_gestores_organizacao", { _organization_id: envio.organization_id });
        if (erroDest) throw new Error(`destinatários: ${erroDest.code}`);
        const emails = ((dest ?? []) as { email: string }[]).map((d) => d.email).filter(Boolean);
        // Sem endereço não há o que mandar: registra, para não reavaliar a
        // cada 2 minutos. O lembrete de 24 h alcança quem chegar depois.
        if (emails.length) {
          const m =
            envio.destinatario === "arkefit"
              ? montarEmailArkeFit(envio.itens, siteUrl)
              : montarEmailGestor(envio.itens[0].academia, envio.itens, siteUrl);
          await enviar(emails, m, await chaveDoEnvio(envio));
          enviados++;
        }
        const { error: erroRegistro } = await admin.rpc("registrar_aviso_catracas", {
          _destinatario: envio.destinatario,
          _itens: envio.itens,
        });
        if (erroRegistro) throw new Error(`enviado, mas não registrado: ${erroRegistro.code}`);
      } catch (erro) {
        falhas++;
        ultimaFalha = descreverErro(erro);
        console.error("alertar-catracas: falha num aviso", envio.destinatario, erro instanceof Error ? erro.name : typeof erro);
      }
    }

    await registrarExecucao(admin, NOME, falhas === 0, falhas ? `${falhas} envio(s) sem sucesso; o último: ${ultimaFalha}` : undefined);
    return jsonResponse({ ok: falhas === 0, avisos: lista.length, emails: enviados, falhas });
  } catch (erro) {
    console.error("alertar-catracas: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

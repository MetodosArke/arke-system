import { createClient } from "npm:@supabase/supabase-js@2";
import { montarEmailArkeFit, montarEmailGestor, type ItemCatraca } from "./email.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "alertar-catracas";

// Aviso de catraca fora do ar, para a ArkeFit e para o gestor de cada
// academia (decisão do responsável, 23/09/2026). Chamada de 2 em 2 minutos
// pelo cron `arke-alerta-catracas`, com o mesmo token do alerta de rotinas;
// quem decide o que avisar é public.catracas_para_alertar() — 10 minutos
// sem sinal, das 6h às 23h, lembrete a cada 24 h e "voltou" quando voltar.
//
// Registra "já avisei" só depois do envio: se o e-mail falha, o aviso sai
// de novo na próxima passada. A ArkeFit recebe um e-mail com tudo; cada
// academia, um com as catracas dela. Falha no envio a uma academia não
// impede as outras nem o da ArkeFit — e o registro de cada uma só acontece
// quando o e-mail dela saiu.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
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
  const enviar = async (para: string[], m: { assunto: string; html: string; texto: string }) => {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
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

    const { data: itens, error } = await admin.rpc("catracas_para_alertar");
    if (error) {
      console.error("alertar-catracas: falha ao avaliar", error.code);
      await registrarExecucao(admin, NOME, false, `catracas_para_alertar: ${error.code}`);
      return jsonResponse({ error: "Falha ao avaliar as catracas." }, 500);
    }
    const lista = (itens ?? []) as ItemCatraca[];
    if (!lista.length) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, avisos: 0 });
    }

    const entregues: ItemCatraca[] = [];
    let falhas = 0;
    let ultimaFalha = "";

    // Um e-mail por academia, para o gestor dela.
    const porAcademia = new Map<string, ItemCatraca[]>();
    for (const i of lista) porAcademia.set(i.organization_id, [...(porAcademia.get(i.organization_id) ?? []), i]);
    let gestores = 0;
    for (const [org, doOrg] of porAcademia) {
      try {
        const { data: dest } = await admin.rpc("emails_gestores_organizacao", { _organization_id: org });
        const emails = (dest ?? []).map((d: { email: string }) => d.email).filter(Boolean);
        if (emails.length) {
          await enviar(emails, montarEmailGestor(doOrg[0].academia, doOrg, siteUrl));
          gestores++;
        }
      } catch (erro) {
        falhas++;
        ultimaFalha = descreverErro(erro);
        console.error("alertar-catracas: falha no aviso a uma academia", erro instanceof Error ? erro.name : typeof erro);
      }
    }

    // A ArkeFit recebe tudo; é o envio que marca "já avisei". Sem ele, o
    // aviso volta na próxima passada — inclusive o do gestor, o que é o
    // certo: melhor repetir do que a ArkeFit não saber.
    const { data: destArke } = await admin.rpc("emails_superadmin");
    const emailsArke = (destArke ?? []).map((d: { email: string }) => d.email).filter(Boolean);
    try {
      if (emailsArke.length) await enviar(emailsArke, montarEmailArkeFit(lista, siteUrl));
      entregues.push(...lista);
    } catch (erro) {
      falhas++;
      ultimaFalha = descreverErro(erro);
    }

    if (entregues.length) {
      const { error: erroRegistro } = await admin.rpc("registrar_alerta_catracas", { _itens: entregues });
      if (erroRegistro) console.error("alertar-catracas: enviado, mas falhou ao registrar", erroRegistro.code);
    }

    await registrarExecucao(admin, NOME, falhas === 0, falhas ? `${falhas} envio(s) sem sucesso; o último: ${ultimaFalha}` : undefined);
    return jsonResponse({ ok: falhas === 0, avisos: lista.length, academias_avisadas: gestores, falhas });
  } catch (erro) {
    console.error("alertar-catracas: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

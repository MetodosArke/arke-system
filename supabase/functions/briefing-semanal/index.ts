import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { chavePublicaVapid } from "../_shared/vapid.ts";

const NOME = "briefing-semanal";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Briefing = {
  organizacao_nome: string;
  gestor_nome: string;
  gestor_user_id: string | null;
  gestor_email: string | null;
  alunos_ativos: number;
  alunos_ativos_mes_passado: number;
  retencao_pct: number | null;
  variacao_pct: number | null;
  novos_na_semana: number;
  em_risco: number;
  resgates_do_mentor: number;
  chamados_para_a_academia: number;
};

/**
 * A frase da retenção.
 *
 * Sem base anterior a frase **diz isso**, em vez de exibir 100% ou 0% — que
 * seriam os dois jeitos de mentir aqui. É a mesma regra que a função do banco
 * segue ao devolver NULL.
 */
function frasePretencao(b: Briefing): string {
  if (b.retencao_pct === null) return "primeira semana de acompanhamento";
  const variacao =
    b.variacao_pct === null || b.variacao_pct === 0
      ? ""
      : b.variacao_pct > 0
        ? `, ${b.variacao_pct}% acima do mês passado`
        : `, ${Math.abs(b.variacao_pct)}% abaixo do mês passado`;
  return `retenção de ${b.retencao_pct}%${variacao}`;
}

function corpoEmail(b: Briefing, url: string): string {
  const linha = (rotulo: string, valor: string) =>
    `<tr><td style="padding:6px 0;color:#555">${rotulo}</td><td style="padding:6px 0;text-align:right;font-weight:600">${valor}</td></tr>`;
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;color:#111">
  <p>Olá, ${b.gestor_nome}!</p>
  <p>O resumo da semana na <strong>${b.organizacao_nome}</strong> já está no seu painel.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
    ${linha("Alunos ativos", `${b.alunos_ativos} <span style="font-weight:400;color:#777">(${frasePretencao(b)})</span>`)}
    ${linha("Novos nesta semana", String(b.novos_na_semana))}
    ${linha("Em risco de evasão", `${b.em_risco} <span style="font-weight:400;color:#777">na fila do Mentor ArkeFit</span>`)}
    ${linha("Resgatados pela nossa equipe", `${b.resgates_do_mentor} nos últimos 7 dias`)}
  </table>
  <p style="font-size:14px">${
    b.chamados_para_a_academia > 0
      ? `Há <strong>${b.chamados_para_a_academia} acolhimento(s) presencial(is)</strong> esperando a sua equipe.`
      : "Nenhuma pendência presencial para a sua equipe esta semana."
  }</p>
  <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Ver o relatório completo</a></p>
  <p style="font-size:12px;color:#888">No relatório você consegue abrir cada número e ver quais alunos estão por trás dele.</p>
</div>`;
}

// Briefing executivo semanal do gestor.
//
// **Três camadas, e nenhuma delas é WhatsApp.** A ideia original era mandar
// pelo WhatsApp, e foi descartada em 23/09/2026 por uma razão de governança
// antes de qualquer outra: a conta da Meta está num CNPJ que o responsável não
// controla, e construir dependência num canal de terceiro é risco, não
// detalhe. Junto foram embora a aprovação de template e a fragilidade dos
// parâmetros posicionais — bastava alguém mexer no template para a mensagem
// sair com os números trocados de lugar, parecendo certa.
//
//   1. o relatório vive **dentro do sistema**, onde cabe abrir cada número e
//      ver quais alunos estão por trás dele;
//   2. **push** avisa que saiu (a PWA já existe e instala em Windows, Android
//      e iOS — no iPhone a Apple exige o app na tela de início para o push
//      funcionar);
//   3. **e-mail** com o resumo, que é o que recupera o alcance do WhatsApp
//      para o dono que não abre o painel.
//
// **Sem LLM, de propósito.** Os números saem de SQL. Um modelo só formataria a
// frase — e introduziria a chance de inventar um número num relatório assinado
// pela ArkeFit, que é o pior defeito possível num relatório.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-briefing-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_briefing", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const appUrl = Deno.env.get("APP_URL") ?? "https://arkefit.com.br";
    const urlRelatorio = `${appUrl}/admin/relatorio-semanal`;

    const { data: alvos, error: erroAlvos } = await admin.rpc("organizacoes_para_briefing");
    if (erroAlvos) {
      console.error("briefing-semanal: falha ao listar organizações", erroAlvos.code);
      await registrarExecucao(admin, NOME, false, `organizacoes_para_briefing: ${erroAlvos.code}`);
      return jsonResponse({ error: "Falha ao listar organizações." }, 500);
    }

    let gerados = 0;
    let emails = 0;
    let pushes = 0;
    let falhas = 0;
    let ultimaFalha = "";

    for (const alvo of (alvos ?? []) as { organization_id: string; semana: string }[]) {
      // Uma academia com problema não deixa as seguintes sem relatório.
      try {
        const { data: linhas } = await admin.rpc("briefing_semanal_organizacao", {
          _organization_id: alvo.organization_id,
        });
        const b = (linhas as Briefing[] | null)?.[0];
        if (!b) continue;

        const numeros = {
          ativos: b.alunos_ativos,
          ativos_mes_passado: b.alunos_ativos_mes_passado,
          retencao_pct: b.retencao_pct,
          variacao_pct: b.variacao_pct,
          novos: b.novos_na_semana,
          em_risco: b.em_risco,
          resgates: b.resgates_do_mentor,
          presenciais: b.chamados_para_a_academia,
        };

        // O relatório **já existe** a partir daqui: o registro é o que o painel lê.
        // Aviso que falha não impede o gestor de ver o relatório quando abrir o
        // sistema — por isso `gerado_em` é gravado antes de qualquer envio.
        await admin.from("briefings_enviados").upsert(
          { organization_id: alvo.organization_id, semana: alvo.semana, numeros, enviado_em: new Date().toISOString() },
          { onConflict: "organization_id,semana" },
        );
        gerados++;

        if (resendKey && b.gestor_email) {
          const envio = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: "ArkeFit <relatorios@arkefit.com.br>",
              to: [b.gestor_email],
              subject: `Resumo da semana — ${b.organizacao_nome}`,
              html: corpoEmail(b, urlRelatorio),
            }),
          });
          if (envio.ok) emails++;
          // Só o status vai para log: a resposta do Resend ecoa o endereço.
          else console.error("briefing-semanal: Resend recusou", envio.status);
        }

        if (vapidPrivateKey && b.gestor_user_id) {
          const { data: inscricoes } = await admin
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .eq("user_id", b.gestor_user_id);
          for (const s of inscricoes ?? []) {
            try {
              webpush.setVapidDetails("mailto:contato@arkefit.com.br", chavePublicaVapid(vapidPrivateKey), vapidPrivateKey);
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                JSON.stringify({
                  title: "Seu resumo da semana saiu",
                  body: `${b.alunos_ativos} alunos ativos · ${b.em_risco} em risco sendo tratados pelo Mentor`,
                  url: "/admin/relatorio-semanal",
                }),
              );
              pushes++;
            } catch {
              // Inscrição expirada é o caso comum e não é defeito: o gestor
              // trocou de aparelho ou revogou a permissão.
            }
          }
        }
      } catch (erro) {
        console.error("briefing-semanal: falha numa academia", erro instanceof Error ? erro.name : typeof erro);
        falhas++;
        ultimaFalha = descreverErro(erro);
      }
    }

    await registrarExecucao(admin, NOME, falhas === 0, falhas ? `${falhas} academia(s) sem relatório; o último erro: ${ultimaFalha}` : undefined);
    return jsonResponse({ ok: falhas === 0, relatorios_gerados: gerados, emails, pushes, falhas });
  } catch (erro) {
    console.error("briefing-semanal: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

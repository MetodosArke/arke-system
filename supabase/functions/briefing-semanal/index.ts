import { createClient } from "npm:@supabase/supabase-js@2";
import { enviarTemplateWhatsapp, normalizarTelefone } from "../_shared/whatsapp.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Briefing = {
  organizacao_nome: string;
  gestor_nome: string;
  gestor_telefone: string | null;
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
 * Os parâmetros do template aprovado na Meta, **em ordem**.
 *
 * A Meta não nomeia as posições: o template é um texto com {{1}}, {{2}}… e o
 * que chega é um array. Mexer no template sem mexer aqui (ou o contrário)
 * produz uma mensagem com os números trocados de lugar — que é pior que não
 * mandar mensagem nenhuma, porque parece certa.
 *
 * Template correspondente (o que precisa ser aprovado):
 *
 *   Olá, {{1}}! Resumo da semana na {{2}}:
 *   • {{3}} alunos ativos ({{4}})
 *   • {{5}} novo(s) aluno(s) nesta semana
 *   • {{6}} em risco de evasão, já na fila do Mentor ArkeFit
 *   • {{7}} aluno(s) resgatado(s) pela nossa equipe nos últimos 7 dias
 *   {{8}}
 */
function montarParametros(b: Briefing): string[] {
  // "Nenhum número inventado": quando não há base anterior, a frase diz isso
  // em vez de exibir 100% ou 0%, que seriam os dois jeitos de mentir aqui.
  const retencao =
    b.retencao_pct === null
      ? "primeira semana de acompanhamento"
      : `retenção de ${b.retencao_pct}%${
          b.variacao_pct === null || b.variacao_pct === 0
            ? ""
            : b.variacao_pct > 0
              ? `, ${b.variacao_pct}% acima do mês passado`
              : `, ${Math.abs(b.variacao_pct)}% abaixo do mês passado`
        }`;

  const pendencia =
    b.chamados_para_a_academia > 0
      ? `Há ${b.chamados_para_a_academia} acolhimento(s) presencial(is) esperando a sua equipe no painel.`
      : "Nenhuma pendência presencial para a sua equipe esta semana.";

  return [
    b.gestor_nome,
    b.organizacao_nome,
    String(b.alunos_ativos),
    retencao,
    String(b.novos_na_semana),
    String(b.em_risco),
    String(b.resgates_do_mentor),
    pendencia,
  ];
}

// Briefing executivo semanal: o retrato da base que a ArkeFit manda ao dono da
// academia toda segunda.
//
// **Sem LLM, de propósito.** Os números saem de SQL e entram no template como
// parâmetros. Um modelo só formataria a frase — e introduziria a chance de
// inventar um número numa mensagem assinada pela ArkeFit, no WhatsApp do dono.
// Num relatório, esse é o pior defeito possível.
//
// Autenticado pelo token do Vault, no mesmo desenho do alerta de rotinas: o
// segredo nasce no banco e não aparece escrito no comando do cron.
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

  const template = Deno.env.get("WHATSAPP_TEMPLATE_BRIEFING") ?? "arke_briefing_semanal";
  const { data: alvos, error: erroAlvos } = await admin.rpc("organizacoes_para_briefing");
  if (erroAlvos) {
    console.error("briefing-semanal: falha ao listar organizações", erroAlvos.code);
    return jsonResponse({ error: "Falha ao listar organizações." }, 500);
  }

  let enviados = 0;
  let semTelefone = 0;
  let falhas = 0;
  let desligado = false;

  for (const alvo of (alvos ?? []) as { organization_id: string; semana: string }[]) {
    const { data: linhas } = await admin.rpc("briefing_semanal_organizacao", {
      _organization_id: alvo.organization_id,
    });
    const b = (linhas as Briefing[] | null)?.[0];
    if (!b) continue;

    const destino = normalizarTelefone(b.gestor_telefone);
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

    if (!destino) {
      semTelefone++;
      // Registrado mesmo sem envio: sem isso, uma academia sem telefone ficaria
      // invisível e ninguém descobriria que ela nunca recebe o briefing.
      await admin.from("briefings_enviados").upsert(
        { organization_id: alvo.organization_id, semana: alvo.semana, numeros, erro: "Gestor sem telefone cadastrado." },
        { onConflict: "organization_id,semana" },
      );
      continue;
    }

    const envio = await enviarTemplateWhatsapp((n) => Deno.env.get(n), {
      para: destino,
      template,
      parametros: montarParametros(b),
    });

    if (!envio.ok && envio.desligado) {
      desligado = true;
      break;
    }

    // O registro é gravado **depois** do envio, e o `enviado_em` só é
    // preenchido quando deu certo: assim a próxima execução tenta de novo o
    // que falhou, em vez de dar por entregue o que nunca saiu.
    await admin.from("briefings_enviados").upsert(
      {
        organization_id: alvo.organization_id,
        semana: alvo.semana,
        destino,
        numeros,
        enviado_em: envio.ok ? new Date().toISOString() : null,
        erro: envio.ok ? null : envio.erro,
      },
      { onConflict: "organization_id,semana" },
    );

    if (envio.ok) enviados++;
    else falhas++;
  }

  if (desligado) {
    return jsonResponse({
      ok: true,
      desligado: true,
      detalhe: "WhatsApp não configurado (WHATSAPP_TOKEN/WHATSAPP_PHONE_ID). Nada foi enviado.",
    });
  }
  return jsonResponse({ ok: true, enviados, sem_telefone: semTelefone, falhas });
});

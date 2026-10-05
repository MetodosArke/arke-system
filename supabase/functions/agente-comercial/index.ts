import { createClient } from "npm:@supabase/supabase-js@2";
import { conversarComIA } from "../_shared/ia.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import {
  categoriaPorPalavras,
  entradaDoModelo,
  lerRespostaModelo,
  montarEmail,
  SISTEMA_ESPELHO,
  usaEspelho,
  type Categoria,
  type Etapa,
  type Origem,
} from "./fluxo.ts";
import { servir } from "../_shared/servir.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NOME = "agente-comercial";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Letícia, o agente comercial (semana 1 do plano dos agentes, 28/09/2026).
//
// Dois caminhos:
// - a rotina `arke-agente-comercial`, de 5 em 5 minutos, com o token do
//   alerta de rotinas (header x-alerta-token): manda a primeira resposta e os
//   lembretes que `leads_para_agente_comercial()` diz estarem devidos — os
//   contatos do site sozinhos, os dos outros canais só quando a equipe aciona
//   (`acionar_agente_comercial`);
// - o "não quero mais receber", público (verify_jwt = false): o link do
//   e-mail leva à página do app, que manda `{parar: <token>}`, e o cabeçalho
//   List-Unsubscribe do e-mail faz o mesmo por `?parar=<token>`. A resposta é
//   igual exista ou não o token.
//
// Nada do contato vai para log: só códigos de erro e status HTTP.
servir("agente-comercial", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // ── "Não quero mais receber" ────────────────────────────────────────────
  const url = new URL(req.url);
  let parar = url.searchParams.get("parar");
  const token = req.headers.get("x-alerta-token");
  if (!parar && !token) {
    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    parar = typeof corpo.parar === "string" ? corpo.parar : null;
  }
  if (parar !== null) {
    if (UUID.test(parar)) {
      const { error } = await admin.rpc("parar_agente_comercial", { _token: parar });
      if (error) {
        console.error("agente-comercial: falha ao registrar o pedido para parar", error.code);
        return jsonResponse({ error: "Não foi possível registrar agora. Tente de novo em instantes." }, 500);
      }
    }
    return jsonResponse({ ok: true });
  }

  // ── Rotina ──────────────────────────────────────────────────────────────
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  const falha = async (status: number, publico: string, interno: string) => {
    await registrarExecucao(admin, NOME, false, interno);
    return jsonResponse({ error: publico }, status);
  };

  try {
    const { data: devidas, error: erroDevidas } = await admin.rpc("leads_para_agente_comercial", { _limite: 20 });
    if (erroDevidas) return await falha(500, "Falha ao ler os contatos.", `leads_para_agente_comercial: ${erroDevidas.code}`);
    if (!devidas?.length) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, enviados: 0 });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return await falha(500, "Configuração do servidor incompleta.", "RESEND_API_KEY ausente");

    const { data: textos } = await admin
      .from("plataforma_textos")
      .select("chave, valor")
      .in("chave", ["agenda_demonstracao_url", "agente_comercial_assinatura", "comercial_email"]);
    const texto = (chave: string) => (textos ?? []).find((t) => t.chave === chave)?.valor?.trim() || null;
    const agenda = texto("agenda_demonstracao_url");
    if (!agenda) return await falha(500, "Sem link da agenda.", "agenda_demonstracao_url vazia com o agente ligado");
    const assinatura = texto("agente_comercial_assinatura") ?? "Equipe comercial ArkeFit";
    const responderPara = texto("comercial_email");

    const { data: cfgIa } = await admin.from("plataforma_config").select("valor").eq("chave", "agente_comercial_ia").maybeSingle();
    const usarIa = Number(cfgIa?.valor ?? 0) === 1;

    const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br";
    const de = Deno.env.get("EMAIL_COMERCIAL_FROM") ?? "ArkeFit <comercial@arkefit.com.br>";

    let enviados = 0;
    const erros: string[] = [];
    for (const d of devidas as {
      lead_id: string;
      etapa: Etapa;
      nome: string | null;
      academia: string;
      email: string;
      alunos_faixa: string | null;
      sistema_atual: string | null;
      mensagem: string | null;
      token_parar: string;
      categoria: Categoria | null;
      origem: Origem;
      origem_detalhe: string | null;
    }[]) {
      const { data: reserva, error: erroReserva } = await admin.rpc("reservar_mensagem_agente_comercial", {
        _lead_id: d.lead_id,
        _etapa: d.etapa,
      });
      if (erroReserva) {
        erros.push(`reserva: ${erroReserva.code}`);
        continue;
      }
      if (!reserva) continue; // outra rodada pegou

      // Assunto e espelho: só na primeira mensagem. Os lembretes repetem o
      // assunto que a primeira identificou. O assunto escolhido pela equipe
      // (`interesse`) chega como categoria e vale mais que o palpite da IA. A
      // IA só é chamada onde a academia contou algo (`usaEspelho`).
      const escolhida = d.categoria;
      let categoria: Categoria = escolhida ?? categoriaPorPalavras(d.mensagem);
      let espelho: string | null = null;
      let origem: "ia" | "modelo" = "modelo";
      if (d.etapa === "primeira" && usarIa && usaEspelho(d.origem) && d.mensagem?.trim()) {
        const resposta = await conversarComIA((n) => Deno.env.get(n), {
          sistema: SISTEMA_ESPELHO,
          usuario: entradaDoModelo({ mensagem: d.mensagem, alunos_faixa: d.alunos_faixa, sistema_atual: d.sistema_atual }),
          maxTokens: 300,
          temperatura: 0.3,
        });
        if (resposta.ok) {
          const lido = lerRespostaModelo(resposta.texto);
          if (lido.categoria && !escolhida) categoria = lido.categoria;
          if (lido.espelho) {
            espelho = lido.espelho;
            origem = "ia";
          }
        }
      }

      const linkParar = `${siteUrl}/#/contato/parar?t=${d.token_parar}`;
      const email = montarEmail({
        etapa: d.etapa,
        nome: d.nome ?? "",
        academia: d.academia,
        categoria,
        espelho,
        origem: d.origem,
        origemDetalhe: d.origem_detalhe,
        agenda,
        linkParar,
        assinatura,
      });

      let resendId: string | null = null;
      let enderecoInvalido = false;
      try {
        const envio = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
            // Uma rodada que caiu depois de enviar não pode mandar de novo.
            "Idempotency-Key": `agente-comercial/${d.lead_id}/${d.etapa}`,
          },
          body: JSON.stringify({
            from: de,
            to: [d.email],
            ...(responderPara ? { reply_to: responderPara } : {}),
            subject: email.assunto,
            html: email.html,
            text: email.texto,
            headers: {
              "List-Unsubscribe": `<${supabaseUrl}/functions/v1/agente-comercial?parar=${d.token_parar}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (envio.ok) {
          const r = await envio.json().catch(() => ({}));
          resendId = typeof r?.id === "string" ? r.id : "";
        } else {
          enderecoInvalido = envio.status === 422;
          erros.push(`Resend HTTP ${envio.status}`);
        }
      } catch (e) {
        erros.push(`envio: ${e instanceof Error ? e.name : typeof e}`);
      }

      const { error: erroConcluir } = await admin.rpc("concluir_mensagem_agente_comercial", {
        _id: reserva,
        _enviada: resendId !== null,
        _assunto: email.assunto,
        _corpo: email.texto,
        _origem_texto: origem,
        _categoria: categoria,
        _resend_id: resendId,
        _endereco_invalido: enderecoInvalido,
      });
      if (erroConcluir) erros.push(`concluir: ${erroConcluir.code}`);
      if (resendId !== null) enviados++;
    }

    // Endereço inválido é desfecho do contato, não defeito da rotina.
    const defeitos = erros.filter((e) => e !== "Resend HTTP 422");
    if (defeitos.length) return await falha(502, "Parte das mensagens não saiu.", defeitos.slice(0, 5).join("; "));
    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, enviados });
  } catch (erro) {
    console.error("agente-comercial: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return await falha(500, "Erro inesperado.", descreverErro(erro));
  }
});

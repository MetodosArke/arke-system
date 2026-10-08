import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { cancelarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";
import { verificada } from "../_shared/verificacao.ts";
import { acessoArkefit } from "../_shared/acessoArkefit.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { executarComDesfecho, type Preparo, type Resultado } from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Aprovação de um clique, na Visão Master → Vigia: uma ação de regra de
// nível 2 ou uma ação proposta pela análise por IA.
//
// A ordem é o que impede executar duas vezes: public.vigia_preparar_aprovacao
// confere o papel e RESERVA a decisão antes de qualquer execução — dois
// cliques, ou duas abas, e o segundo recebe "já foi decidida". Só depois a
// ação roda, e o desfecho vai para vigia_acoes e para a Auditoria — sempre,
// inclusive quando a execução lança (fluxo.ts, executarComDesfecho). Se nem
// isso der certo (a função morta no meio), o Vigia fecha a ação presa em
// "executando" como erro (vigia_fechar_acoes_sem_desfecho).
//
// O que precisa do Asaas roda aqui, com a chave pelo roteador de ambiente;
// o resto roda no banco (public.vigia_executar).
servir("vigia-aprovar", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("vigia-aprovar: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const corpo = await req.json().catch(() => ({}));
    const origem = corpo?.origem;
    const id = Number(corpo?.id);
    const indice = corpo?.indice === undefined || corpo?.indice === null ? null : Number(corpo.indice);
    if ((origem !== "regra" && origem !== "analise") || !Number.isInteger(id) || (origem === "analise" && !Number.isInteger(indice))) {
      return jsonResponse({ error: "Pedido inválido." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: erroClaims } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const uid = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (erroClaims || !uid) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    // O papel é conferido no banco com a service role, onde `has_role` não
    // exige as duas etapas (sem `auth.uid()`, a pergunta é sobre outra pessoa).
    // Por isso a sessão verificada é conferida aqui, antes de qualquer coisa.
    if (!verificada(claims?.claims)) {
      return jsonResponse({ error: "Aprovar ação do Vigia exige a verificação em duas etapas. Entre de novo com o código do aplicativo." }, 403);
    }
    // Aprovar é do Sócio (os níveis da equipe ArkeFit, 08/10/2026: o Suporte
    // lê o Vigia, mas não decide). A pergunta vai ao banco com a sessão de
    // quem chama; `vigia_preparar_aprovacao` confere de novo, pelo papel.
    const socio = await acessoArkefit(asUser, claims?.claims, "socio");
    if (socio === null) return jsonResponse({ error: "Não foi possível conferir o acesso agora. Tente de novo." }, 500);
    if (!socio) return jsonResponse({ error: "Só um sócio da ArkeFit aprova as ações do Vigia." }, 403);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: prep, error: erroPrep } = await admin.rpc("vigia_preparar_aprovacao", {
      _uid: uid,
      _origem: origem,
      _id: id,
      _indice: indice,
    });
    if (erroPrep || !prep) {
      // As recusas da função são nossas, em português (`raise exception`:
      // P0001, e 42501 para quem não é da ArkeFit): podem ir para a tela. A
      // mensagem crua de outra falha do banco, não (frente D, 07/10/2026).
      if (erroPrep?.code === "42501") return jsonResponse({ error: erroPrep.message }, 403);
      if (erroPrep?.code === "P0001") return jsonResponse({ error: erroPrep.message }, 409);
      if (erroPrep) console.error("vigia-aprovar: preparar", resumoDoErro(erroPrep));
      return jsonResponse({ error: "Não foi possível aprovar agora. Tente de novo." }, erroPrep ? 500 : 409);
    }

    // Daqui em diante a decisão está reservada: toda saída registra o
    // desfecho, inclusive a exceção de um `fetch` que estourou o prazo.
    const { resultado: res, registrado } = await executarComDesfecho(
      prep as Preparo,
      async (p): Promise<Resultado> => {
        if (p.ferramenta === "cancelar_assinatura_orfa") {
          // Assinatura órfã só é procurada na produção (a conferência exclui a
          // homologação), então o ambiente é o de produção.
          const amb = ambienteAsaas(null, (n) => Deno.env.get(n));
          if ("erro" in amb) return { resultado: "erro", detalhe: amb.erro };
          const r = await cancelarAssinatura(amb.api, amb.chave, String(p.alvo));
          return r.ok
            ? { resultado: "ok", detalhe: r.jaEstavaCancelada ? "A assinatura já estava cancelada no Asaas." : "Assinatura cancelada no Asaas." }
            : { resultado: "erro", detalhe: r.erro };
        }
        if (p.ferramenta === "reprocessar_evento_asaas") return reprocessarAvisos(admin, supabaseUrl, String(p.alvo));
        const { data: r, error: erroExec } = await admin.rpc("vigia_executar", {
          _ferramenta: p.ferramenta,
          _alvo: p.alvo,
          _contexto: p.contexto ?? {},
        });
        return erroExec ? { resultado: "erro", detalhe: `Falha ao executar (${erroExec.code}).` } : (r as Resultado);
      },
      async (d) => {
        const { error } = await admin.rpc("vigia_concluir_acao", {
          _acao_id: d.acao_id,
          _resultado: d.resultado,
          _detalhe: d.detalhe,
          _comando_id: d.comando_id,
        });
        return { error };
      },
    );
    if (!registrado) console.error("vigia-aprovar: o desfecho não foi registrado", prep.acao_id);

    return res.resultado === "ok"
      ? jsonResponse({ ok: true, detalhe: res.detalhe })
      : jsonResponse({ error: res.detalhe }, 502);
  } catch (erro) {
    console.error("vigia-aprovar: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

// Processa de novo os avisos do Asaas daquele tipo que falharam, reenviando o
// próprio aviso guardado ao asaas-webhook — o mesmo caminho da reconciliação:
// o efeito no banco sai do código dos webhooks de verdade, e o evento ainda
// não processado é processado, não duplicado.
async function reprocessarAvisos(
  admin: SupabaseClient,
  supabaseUrl: string,
  tipoEvento: string,
): Promise<Resultado> {
  const segredo = Deno.env.get("ASAAS_WEBHOOK_SECRET");
  if (!segredo) return { resultado: "erro", detalhe: "ASAAS_WEBHOOK_SECRET não configurado." };
  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: eventos, error } = await admin
    .from("asaas_webhook_events")
    .select("id, payload")
    .eq("tipo_evento", tipoEvento)
    .eq("processado", false)
    .not("erro", "is", null)
    .gte("created_at", desde)
    .limit(50);
  if (error) return { resultado: "erro", detalhe: `Falha ao ler os avisos (${error.code}).` };
  const lista = (eventos ?? []) as { id: string; payload: unknown }[];
  if (!lista.length) return { resultado: "ok", detalhe: "Nenhum aviso pendente desse tipo — já foram processados." };
  let ok = 0;
  for (const e of lista) {
    // Um aviso que estoura o prazo conta como não processado; os outros seguem.
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/asaas-webhook`, {
        signal: AbortSignal.timeout(30_000),
        method: "POST",
        headers: { "Content-Type": "application/json", "asaas-access-token": segredo },
        body: JSON.stringify(e.payload),
      });
      if (r.ok) ok++;
    } catch {
      // segue para o próximo
    }
  }
  return ok === lista.length
    ? { resultado: "ok", detalhe: `${ok} aviso(s) ${tipoEvento} processado(s) de novo.` }
    : { resultado: "erro", detalhe: `${ok} de ${lista.length} aviso(s) processado(s); os outros continuam com erro.` };
}

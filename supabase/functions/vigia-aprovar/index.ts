import { createClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { cancelarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Resultado = { resultado: "ok" | "erro" | "ignorada"; detalhe: string; comando_id?: string | null };

// Aprovação de um clique, na Visão Master → Vigia: uma ação de regra de
// nível 2 ou uma ação proposta pela análise por IA.
//
// A ordem é o que impede executar duas vezes: public.vigia_preparar_aprovacao
// confere o papel e RESERVA a decisão antes de qualquer execução — dois
// cliques, ou duas abas, e o segundo recebe "já foi decidida". Só depois a
// ação roda, e o desfecho vai para vigia_acoes e para a Auditoria.
//
// O que precisa do Asaas roda aqui, com a chave pelo roteador de ambiente;
// o resto roda no banco (public.vigia_executar).
Deno.serve(async (req: Request) => {
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

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: prep, error: erroPrep } = await admin.rpc("vigia_preparar_aprovacao", {
      _uid: uid,
      _origem: origem,
      _id: id,
      _indice: indice,
    });
    if (erroPrep || !prep) {
      // As mensagens são nossas, em português: podem ir para a tela.
      return jsonResponse({ error: erroPrep?.message ?? "Não foi possível aprovar." }, erroPrep?.code === "42501" ? 403 : 409);
    }

    let res: Resultado;
    if (prep.ferramenta === "cancelar_assinatura_orfa") {
      // Assinatura órfã só é procurada na produção (a conferência exclui a
      // homologação), então o ambiente é o de produção.
      const amb = ambienteAsaas(null, (n) => Deno.env.get(n));
      if ("erro" in amb) {
        res = { resultado: "erro", detalhe: amb.erro };
      } else {
        const r = await cancelarAssinatura(amb.api, amb.chave, String(prep.alvo));
        res = r.ok
          ? { resultado: "ok", detalhe: r.jaEstavaCancelada ? "A assinatura já estava cancelada no Asaas." : "Assinatura cancelada no Asaas." }
          : { resultado: "erro", detalhe: r.erro };
      }
    } else if (prep.ferramenta === "reprocessar_evento_asaas") {
      res = await reprocessarAvisos(admin, supabaseUrl, String(prep.alvo));
    } else {
      const { data: r, error: erroExec } = await admin.rpc("vigia_executar", {
        _ferramenta: prep.ferramenta,
        _alvo: prep.alvo,
        _contexto: prep.contexto ?? {},
      });
      res = erroExec ? { resultado: "erro", detalhe: `Falha ao executar (${erroExec.code}).` } : (r as Resultado);
      // Ordem igual já na fila do Gateway: o que foi aprovado já vai acontecer.
      if (res.resultado === "ignorada") res = { ...res, resultado: "ok" };
    }

    const { error: erroConcluir } = await admin.rpc("vigia_concluir_acao", {
      _acao_id: prep.acao_id,
      _resultado: res.resultado,
      _detalhe: res.detalhe,
      _comando_id: res.comando_id ?? null,
    });
    if (erroConcluir) console.error("vigia-aprovar: executou, mas falhou ao registrar", erroConcluir.code);

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
  admin: ReturnType<typeof createClient>,
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
    const r = await fetch(`${supabaseUrl}/functions/v1/asaas-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": segredo },
      body: JSON.stringify(e.payload),
    });
    if (r.ok) ok++;
  }
  return ok === lista.length
    ? { resultado: "ok", detalhe: `${ok} aviso(s) ${tipoEvento} processado(s) de novo.` }
    : { resultado: "erro", detalhe: `${ok} de ${lista.length} aviso(s) processado(s); os outros continuam com erro.` };
}

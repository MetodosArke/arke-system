import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { diaBrasilia, hojeBrasilia } from "../_shared/data.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import {
  asaasGet,
  emPedacos,
  eventoParaCorrigir,
  listagensDaVarredura,
  listarTodas,
  origemDaReferencia,
  TABELA,
  type Origem,
  type PagamentoAsaas,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reconciliacao-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Reconciliação Asaas ↔ banco. Ver a migration 20261201010000 para o porquê.
//
// Pergunta ao Asaas a situação real das cobranças e, quando ela diverge do
// banco, **reenvia o evento correspondente ao asaas-webhook**. O efeito no
// banco sai do mesmo código que trata os webhooks de verdade — não existe uma
// segunda implementação de "o que fazer quando confirma" para divergir da
// primeira. O id do evento reenviado é `reconciliacao:<pagamento>:<status>`,
// então a correção aparece no painel de webhooks com origem clara, e reenviar
// a mesma divergência duas vezes não repete o efeito.
//
// Dois modos:
//   - varredura: pg_cron, uma vez por dia, autenticada pelo token do Vault.
//     Em lote (ver fluxo.ts): o Asaas lista as vencidas, as criadas e as
//     recebidas nos últimos dias; o banco é lido em páginas; só a cobrança
//     vencida que ficou sem resposta é consultada uma a uma, dentro de um
//     orçamento de tempo. Depois, as assinaturas ativas no Asaas que o banco
//     não conhece.
//   - aluno: o botão "Já paguei, verificar novamente" da tela de bloqueio.
//     Confere só a assinatura daquele aluno — o caminho mais curto para quem
//     pagou e ficou bloqueado porque o PAYMENT_CONFIRMED se perdeu.

// Uma edge function tem limite de tempo (150 s no plano gratuito, 400 s no
// pago). As consultas uma a uma param antes disso, e o que sobrar vira aviso.
const ORCAMENTO_MS = 110_000;

type Divergencia = {
  origem: Origem;
  pagamento: string;
  asaas: string;
  banco: string | null;
  corrigida: boolean;
};

async function reenviarAoWebhook(supabaseUrl: string, segredoWebhook: string, evento: string, p: PagamentoAsaas) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/asaas-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "asaas-access-token": segredoWebhook },
    body: JSON.stringify({
      id: `reconciliacao:${p.id}:${p.deleted ? "DELETED" : p.status}`,
      event: evento,
      payment: p,
    }),
  });
  return resp.ok;
}

type Contexto = {
  admin: SupabaseClient;
  api: string;
  chave: string;
  supabaseUrl: string;
  segredoWebhook: string;
  verificadas: number;
  divergencias: Divergencia[];
  /** Consultas ao Asaas que falharam; qualquer uma vira erro no registro. */
  falhas: string[];
};

/** Confere um pagamento do Asaas contra o status local e reenvia o evento se divergir. */
async function conferir(ctx: Contexto, p: PagamentoAsaas, statusLocal: string | null, origem: Origem) {
  ctx.verificadas++;
  const evento = eventoParaCorrigir(p, statusLocal, origem);
  if (!evento) return;
  const corrigida = await reenviarAoWebhook(ctx.supabaseUrl, ctx.segredoWebhook, evento, p);
  ctx.divergencias.push({ origem, pagamento: p.id, asaas: p.deleted ? "DELETED" : p.status, banco: statusLocal, corrigida });
}

/** O status local de cada pagamento, pela tabela da origem de cada um, em pedaços de 100. */
async function statusLocais(admin: SupabaseClient, itens: { id: string; origem: Origem }[]) {
  const status = new Map<string, string>();
  for (const origem of Object.keys(TABELA) as Origem[]) {
    const ids = itens.filter((i) => i.origem === origem).map((i) => i.id);
    for (const pedaco of emPedacos(ids)) {
      const { data, error } = await admin.from(TABELA[origem]).select("asaas_payment_id, status").in("asaas_payment_id", pedaco);
      if (error) throw new Error(`${TABELA[origem]}: ${error.message}`);
      for (const l of data ?? []) status.set(l.asaas_payment_id as string, l.status as string);
    }
  }
  return status;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const chave = Deno.env.get("ASAAS_API_KEY");
  const segredoWebhook = Deno.env.get("ASAAS_WEBHOOK_SECRET");
  const api = Deno.env.get("ASAAS_API_URL") ?? "https://api.asaas.com/v3";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !chave || !segredoWebhook) {
    console.error("Configuração incompleta para reconciliação");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const ctx: Contexto = { admin, api, chave, supabaseUrl, segredoWebhook, verificadas: 0, divergencias: [], falhas: [] };

  // --- Modo varredura (pg_cron) --------------------------------------------
  const token = req.headers.get("x-reconciliacao-token");
  if (token) {
    const { data: valido } = await admin.rpc("conferir_token_reconciliacao", { _token: token });
    if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);
    const inicio = Date.now();

    // A varredura é da produção, e por isso exclui as organizações em trial.
    //
    // Desde 23/09/2026 organização em trial fala com o **sandbox** do Asaas
    // (ver `_shared/asaas.ts`): as cobranças dela existem lá, não aqui.
    // Perguntar à produção por um id de sandbox devolveria "não encontrado"
    // para toda uma academia de homologação — ruído diário na faixa vermelha
    // da Visão Master, exatamente onde só deveria aparecer problema real.
    const { data: emHomologacao } = await admin.from("organizations").select("id").eq("status", "trial");
    const idsHomologacao = (emHomologacao ?? []).map((o) => o.id as string);
    const foraDeHomologacao = <T extends { not: (c: string, o: string, v: string) => T }>(consulta: T): T =>
      idsHomologacao.length ? consulta.not("organization_id", "in", `(${idsHomologacao.join(",")})`) : consulta;

    let erro: string | null = null;
    let orfas: { id: string; referencia: string }[] = [];
    let naoConferidas = 0;
    try {
      // 1. O que o banco tem em aberto e já venceu: é aqui que uma confirmação
      //    perdida bloquearia quem pagou.
      const hoje = hojeBrasilia();
      const abertas = new Map<string, { status: string; origem: Origem }>();
      for (const origem of Object.keys(TABELA) as Origem[]) {
        const linhas = await todasAsLinhas<{ asaas_payment_id: string; status: string }>((de, ate) =>
          foraDeHomologacao(
            admin
              .from(TABELA[origem])
              .select("asaas_payment_id, status")
              .not("asaas_payment_id", "is", null)
              .in("status", ["pendente", "atrasado"])
              .lte("vencimento", hoje),
          )
            .order("asaas_payment_id")
            .range(de, ate)
        );
        for (const l of linhas) abertas.set(l.asaas_payment_id, { status: l.status, origem });
      }

      // 2. O Asaas lista em lote o que interessa, de 100 em 100.
      const vistos = new Map<string, PagamentoAsaas>();
      for (const caminho of listagensDaVarredura((n) => diaBrasilia(-n))) {
        for (const p of await listarTodas<PagamentoAsaas>(api, chave, caminho)) vistos.set(p.id, p);
      }
      const doArke = [...vistos.values()]
        .map((p) => ({ p, origem: abertas.get(p.id)?.origem ?? origemDaReferencia(p.externalReference) }))
        .filter((x): x is { p: PagamentoAsaas; origem: Origem } => x.origem !== null);
      const locais = await statusLocais(
        admin,
        doArke.filter((x) => !abertas.has(x.p.id)).map((x) => ({ id: x.p.id, origem: x.origem })),
      );
      for (const { p, origem } of doArke) {
        await conferir(ctx, p, abertas.get(p.id)?.status ?? locais.get(p.id) ?? null, origem);
      }

      // 3. Vencida em aberto que nenhuma listagem trouxe (removida, estornada,
      //    ou paga há mais tempo que a janela): uma a uma, dentro do orçamento.
      const semResposta = [...abertas.entries()].filter(([id]) => !vistos.has(id));
      for (let i = 0; i < semResposta.length; i++) {
        if (Date.now() - inicio > ORCAMENTO_MS) {
          naoConferidas = semResposta.length - i;
          break;
        }
        const [id, local] = semResposta[i];
        let p: PagamentoAsaas;
        try {
          p = await asaasGet<PagamentoAsaas>(api, chave, `/payments/${encodeURIComponent(id)}`);
        } catch (e) {
          ctx.falhas.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        await conferir(ctx, p, local.status, local.origem);
      }

      // 4. Assinatura ativa no Asaas que o banco não conhece: cobra o aluno sem
      //    ninguém ver. Não se corrige sozinha — pode ser do plano próprio, de
      //    outro valor —, então vai para o registro e para a Visão Master.
      const conhecidas = new Set<string>();
      for (const [tabela, status] of [["aluno_assinaturas", ["ativa", "atrasada"]], ["aluno_matriculas_academia", ["ativa"]]] as const) {
        const linhas = await todasAsLinhas<{ asaas_subscription_id: string }>((de, ate) =>
          foraDeHomologacao(
            admin.from(tabela).select("asaas_subscription_id").not("asaas_subscription_id", "is", null).in("status", [...status]),
          )
            .order("asaas_subscription_id")
            .range(de, ate)
        );
        for (const l of linhas) conhecidas.add(l.asaas_subscription_id);
      }
      for (const s of await listarTodas<{ id: string; externalReference?: string }>(api, chave, "/subscriptions?status=ACTIVE")) {
        const ref = s.externalReference ?? "";
        if ((ref.startsWith("metodo:") || ref.startsWith("plano:")) && !conhecidas.has(s.id)) {
          orfas.push({ id: s.id, referencia: ref });
        }
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      console.error("Reconciliação interrompida", erro);
    }

    if (!erro && ctx.falhas.length > 0) {
      erro = `${ctx.falhas.length} consulta(s) ao Asaas falharam: ${ctx.falhas.slice(0, 5).join("; ")}`;
    }
    if (!erro && naoConferidas > 0) {
      // Faltar tempo não é "nada a corrigir": vira aviso na faixa vermelha.
      erro = `Varredura incompleta: ${naoConferidas} cobrança(s) vencida(s) ficaram sem conferir por falta de tempo.`;
    }
    const corrigidas = ctx.divergencias.filter((d) => d.corrigida).length;
    const { error: gravacaoError } = await admin.from("reconciliacoes_asaas").insert({
      modo: "varredura",
      cobrancas_verificadas: ctx.verificadas,
      divergencias: ctx.divergencias.length,
      corrigidas,
      assinaturas_orfas: orfas.length,
      detalhes: { divergencias: ctx.divergencias, orfas, falhas: ctx.falhas, nao_conferidas: naoConferidas, duracao_ms: Date.now() - inicio },
      erro,
    });
    if (gravacaoError) {
      // Foi exatamente assim que a primeira execução falhou calada (403 por
      // falta de grant na sequência): a varredura respondia 200 e o registro
      // não existia.
      console.error("Reconciliação feita, mas o registro não foi gravado", gravacaoError.code, gravacaoError.message);
    }
    orfas = orfas.slice(0, 50);
    return jsonResponse({ verificadas: ctx.verificadas, divergencias: ctx.divergencias.length, corrigidas, orfas, nao_conferidas: naoConferidas });
  }

  // --- Modo aluno (botão da tela de bloqueio) --------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const { aluno_id } = (await req.json().catch(() => ({}))) as { aluno_id?: string };
  if (!aluno_id) return jsonResponse({ error: "Aluno não informado." }, 400);

  // O RLS de `alunos` decide quem enxerga este aluno: ele mesmo ou a equipe
  // da academia. Quem não enxerga recebe 404, como nas outras funções.
  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: aluno } = await asUser.from("alunos").select("id").eq("id", aluno_id).maybeSingle();
  if (!aluno) return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);

  const { data: assinatura } = await admin
    .from("aluno_assinaturas")
    .select("id, asaas_subscription_id, reconciliada_em")
    .eq("aluno_id", aluno.id)
    .maybeSingle();
  if (!assinatura?.asaas_subscription_id) return jsonResponse({ divergencias: 0, corrigidas: 0 });

  // Cada clique consulta o Asaas; uma verificação a cada 30 s basta.
  if (assinatura.reconciliada_em && Date.now() - new Date(assinatura.reconciliada_em).getTime() < 30_000) {
    return jsonResponse({ divergencias: 0, corrigidas: 0, aguarde: true });
  }
  await admin.from("aluno_assinaturas").update({ reconciliada_em: new Date().toISOString() }).eq("id", assinatura.id);

  try {
    const r = await asaasGet<{ data?: PagamentoAsaas[] }>(
      api,
      chave,
      `/payments?subscription=${encodeURIComponent(assinatura.asaas_subscription_id)}&limit=100`,
    );
    const noAsaas = r.data ?? [];
    const locais = await statusLocais(admin, noAsaas.map((p) => ({ id: p.id, origem: "metodo" as const })));
    for (const p of noAsaas) await conferir(ctx, p, locais.get(p.id) ?? null, "metodo");
  } catch {
    // Não dá para dizer ao aluno que está tudo certo sem ter conseguido olhar.
    return jsonResponse({ error: "Não foi possível consultar o pagamento agora. Tente de novo em alguns minutos." }, 502);
  }
  const corrigidas = ctx.divergencias.filter((d) => d.corrigida).length;
  if (ctx.divergencias.length > 0) {
    await admin.from("reconciliacoes_asaas").insert({
      modo: "aluno",
      cobrancas_verificadas: ctx.verificadas,
      divergencias: ctx.divergencias.length,
      corrigidas,
      detalhes: { divergencias: ctx.divergencias },
    });
  }
  return jsonResponse({ divergencias: ctx.divergencias.length, corrigidas });
});

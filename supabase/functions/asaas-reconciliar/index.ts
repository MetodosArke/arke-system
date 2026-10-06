import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { diaBrasilia, hojeBrasilia } from "../_shared/data.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import {
  asaasGet,
  correcaoAplicada,
  emPedacos,
  eventoParaCorrigir,
  idDoReenvio,
  valorDiverge,
  type EventoGravado,
  listagensDaVarredura,
  listarTodas,
  cobrancaDaConta,
  origemDaReferencia,
  origensDaConta,
  TABELA,
  type ContaDaVarredura,
  type Origem,
  type PagamentoAsaas,
} from "./fluxo.ts";
import { chaveCombinaComAmbiente } from "../nfse-emitir/fluxo.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";

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
//     Desde 06/10/2026, a varredura confere também a conta Asaas de cada
//     academia que cobra na própria conta (`asaas_webhook_academia`, com a
//     chave do cofre): lá moram a mensalidade e a avulsa dela. O reenvio vai
//     ao webhook com o segredo da ArkeFit, como sempre.
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
  /** O que o webhook gravou para o reenvio, ou por que não deu para saber. */
  desfecho: string;
  /** "arkefit", ou o id da academia cuja conta foi conferida. */
  conta: string;
};

/**
 * Reenvia o aviso ao webhook e lê o que ele de fato fez: o desfecho gravado
 * em `asaas_webhook_events` e o status da cobrança depois. O 200 da resposta
 * não basta — o webhook responde 200 também ao aviso repetido, ao ignorado e
 * ao que deu erro interno.
 */
async function reenviarAoWebhook(ctx: Contexto, evento: string, p: PagamentoAsaas, origem: Origem) {
  const idAviso = idDoReenvio(p);
  try {
    const resp = await fetch(`${ctx.supabaseUrl}/functions/v1/asaas-webhook`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { "Content-Type": "application/json", "asaas-access-token": ctx.segredoWebhook },
      body: JSON.stringify({ id: idAviso, event: evento, payment: p }),
    });
    // O corpo não interessa; ler libera a conexão.
    await resp.text().catch(() => "");
    if (!resp.ok) {
      // Webhook fora do ar é falha da conferência, e não só uma divergência
      // a mais: vai para `falhas`, que vira erro no registro e aviso do Vigia.
      ctx.falhas.push(`${p.id}: webhook respondeu ${resp.status}`);
      return { corrigida: false, desfecho: `webhook_http_${resp.status}` };
    }
  } catch (e) {
    ctx.falhas.push(`${p.id}: webhook sem resposta`);
    return { corrigida: false, desfecho: `webhook_sem_resposta:${e instanceof Error ? e.name : "falha"}` };
  }
  const [aviso, cobranca] = await Promise.all([
    ctx.admin.from("asaas_webhook_events").select("processado, resultado, erro").eq("asaas_event_id", idAviso).maybeSingle(),
    ctx.admin.from(TABELA[origem]).select("status").eq("asaas_payment_id", p.id).maybeSingle(),
  ]);
  if (aviso.error || cobranca.error) {
    ctx.falhas.push(`${p.id}: desfecho ilegível`);
    return { corrigida: false, desfecho: "desfecho_ilegivel" };
  }
  return correcaoAplicada(
    (aviso.data as EventoGravado | null) ?? null,
    (cobranca.data?.status as string | undefined) ?? null,
    p,
  );
}

type Contexto = {
  admin: SupabaseClient;
  api: string;
  chave: string;
  supabaseUrl: string;
  segredoWebhook: string;
  verificadas: number;
  divergencias: Divergencia[];
  /** Cobrança com valor diferente no Asaas e no banco: vai para o Vigia, que avisa uma pessoa. */
  valores: { origem: Origem; pagamento: string; asaas: number; banco: number; conta: string }[];
  /** Consultas ao Asaas que falharam; qualquer uma vira erro no registro. */
  falhas: string[];
};

type Local = { status: string; valor: number | null };

/**
 * Confere um pagamento do Asaas contra o banco: reenvia o evento se o status
 * divergir, e anota o valor que não bate (esse não se corrige sozinho).
 */
async function conferir(ctx: Contexto, p: PagamentoAsaas, local: Local | null, origem: Origem, conta = "arkefit") {
  ctx.verificadas++;
  const statusLocal = local?.status ?? null;
  if (local && !p.deleted && valorDiverge(p.value, local.valor)) {
    ctx.valores.push({ origem, pagamento: p.id, asaas: p.value as number, banco: Number(local.valor), conta });
  }
  const evento = eventoParaCorrigir(p, statusLocal, origem);
  if (!evento) return;
  const { corrigida, desfecho } = await reenviarAoWebhook(ctx, evento, p, origem);
  ctx.divergencias.push({ origem, pagamento: p.id, asaas: p.deleted ? "DELETED" : p.status, banco: statusLocal, corrigida, desfecho, conta });
}

/** O status e o valor locais de cada pagamento, pela tabela da origem de cada um, em pedaços de 100. */
async function statusLocais(admin: SupabaseClient, itens: { id: string; origem: Origem }[]) {
  const locais = new Map<string, Local>();
  for (const origem of Object.keys(TABELA) as Origem[]) {
    const ids = itens.filter((i) => i.origem === origem).map((i) => i.id);
    for (const pedaco of emPedacos(ids)) {
      const { data, error } = await admin.from(TABELA[origem]).select("asaas_payment_id, status, valor").in("asaas_payment_id", pedaco);
      if (error) throw new Error(`${TABELA[origem]}: ${error.message}`);
      for (const l of data ?? []) {
        locais.set(l.asaas_payment_id as string, { status: l.status as string, valor: l.valor == null ? null : Number(l.valor) });
      }
    }
  }
  return locais;
}

type Aberta = Local & { id: string; origem: Origem; organization_id: string; conta_asaas: string | null };

/**
 * A conta de cada cobrança aberta, pelo id do pagamento: a avulsa guarda a
 * dela; a mensalidade mora onde a matrícula dela nasceu. Em pedaços de 100.
 */
async function contasDasCobrancas(admin: SupabaseClient, origem: "plano" | "avulsa", pagamentos: string[]): Promise<Map<string, string>> {
  const contas = new Map<string, string>();
  for (const pedaco of emPedacos(pagamentos)) {
    if (origem === "avulsa") {
      const { data, error } = await admin.from("cobrancas_avulsas").select("asaas_payment_id, conta_asaas").in("asaas_payment_id", pedaco);
      if (error) throw new Error(`cobrancas_avulsas: ${error.message}`);
      for (const c of data ?? []) contas.set(c.asaas_payment_id as string, c.conta_asaas as string);
      continue;
    }
    const { data: mensalidades, error } = await admin.from("mensalidades").select("asaas_payment_id, matricula_id").in("asaas_payment_id", pedaco);
    if (error) throw new Error(`mensalidades: ${error.message}`);
    const matriculas = [...new Set((mensalidades ?? []).map((m) => m.matricula_id as string).filter(Boolean))];
    const contaDaMatricula = new Map<string, string>();
    if (matriculas.length) {
      const { data, error: erroMatriculas } = await admin.from("aluno_matriculas_academia").select("id, conta_asaas").in("id", matriculas);
      if (erroMatriculas) throw new Error(`aluno_matriculas_academia: ${erroMatriculas.message}`);
      for (const m of data ?? []) contaDaMatricula.set(m.id as string, m.conta_asaas as string);
    }
    for (const m of mensalidades ?? []) {
      const conta = contaDaMatricula.get(m.matricula_id as string);
      if (conta) contas.set(m.asaas_payment_id as string, conta);
    }
  }
  return contas;
}

/**
 * A varredura de uma conta: as listagens em lote, a conferência de cada
 * cobrança do ARKE que veio nelas, a consulta uma a uma da vencida que não
 * veio, e a assinatura ativa que o banco não conhece. `abertas` são todas as
 * cobranças em aberto do banco; só as desta conta entram (`cobrancaDaConta`).
 */
async function varrerConta(
  ctx: Contexto,
  conta: ContaDaVarredura,
  gateway: { api: string; chave: string },
  abertasTodas: Aberta[],
  conhecidas: Set<string>,
  inicio: number,
): Promise<{ naoConferidas: number; orfas: { id: string; referencia: string; conta: string }[] }> {
  const rotulo = conta.nome === "arkefit" ? "arkefit" : conta.organizationId;
  const origens = origensDaConta(conta);
  const abertas = new Map<string, Aberta>();
  for (const a of abertasTodas) if (cobrancaDaConta(conta, a.origem, a)) abertas.set(a.id, a);

  // As listagens em lote, de 100 em 100.
  const vistos = new Map<string, PagamentoAsaas>();
  for (const caminho of listagensDaVarredura((n) => diaBrasilia(-n))) {
    for (const p of await listarTodas<PagamentoAsaas>(gateway.api, gateway.chave, caminho)) vistos.set(p.id, p);
  }
  const doArke = [...vistos.values()]
    .map((p) => ({ p, origem: abertas.get(p.id)?.origem ?? origemDaReferencia(p.externalReference, origens) }))
    .filter((x): x is { p: PagamentoAsaas; origem: Origem } => x.origem !== null);
  const locais = await statusLocais(
    ctx.admin,
    doArke.filter((x) => !abertas.has(x.p.id)).map((x) => ({ id: x.p.id, origem: x.origem })),
  );
  for (const { p, origem } of doArke) {
    await conferir(ctx, p, abertas.get(p.id) ?? locais.get(p.id) ?? null, origem, rotulo);
  }

  // A vencida em aberto que nenhuma listagem trouxe (removida, estornada, ou
  // paga há mais tempo que a janela): uma a uma, dentro do orçamento.
  let naoConferidas = 0;
  const semResposta = [...abertas.entries()].filter(([id]) => !vistos.has(id));
  for (let i = 0; i < semResposta.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      naoConferidas = semResposta.length - i;
      break;
    }
    const [id, local] = semResposta[i];
    let p: PagamentoAsaas;
    try {
      p = await asaasGet<PagamentoAsaas>(gateway.api, gateway.chave, `/payments/${encodeURIComponent(id)}`);
    } catch (e) {
      ctx.falhas.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    await conferir(ctx, p, local, local.origem, rotulo);
  }

  // A assinatura ativa no Asaas que o banco não conhece: cobra o aluno sem
  // ninguém ver. Não se corrige sozinha — pode ser do plano próprio, de outro
  // valor —, então vai para o registro e para a Visão Master.
  const orfas: { id: string; referencia: string; conta: string }[] = [];
  const prefixos = conta.nome === "arkefit" ? ["metodo:", "plano:"] : ["plano:"];
  for (const s of await listarTodas<{ id: string; externalReference?: string }>(gateway.api, gateway.chave, "/subscriptions?status=ACTIVE")) {
    const ref = s.externalReference ?? "";
    if (prefixos.some((pre) => ref.startsWith(pre)) && !conhecidas.has(s.id)) {
      orfas.push({ id: s.id, referencia: ref, conta: rotulo });
    }
  }
  return { naoConferidas, orfas };
}

servir("asaas-reconciliar", async (req: Request) => {
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
  const ctx: Contexto = { admin, api, chave, supabaseUrl, segredoWebhook, verificadas: 0, divergencias: [], valores: [], falhas: [] };

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
    // Filtro aplicado em cada consulta, e não por uma função genérica: o tipo
    // do PostgREST passado adiante fica fundo demais para o Deno (TS2589).
    const homologacao = idsHomologacao.length ? `(${idsHomologacao.join(",")})` : null;

    let erro: string | null = null;
    const orfas: { id: string; referencia: string; conta: string }[] = [];
    let naoConferidas = 0;
    try {
      // 1. O que o banco tem em aberto e já venceu: é aqui que uma confirmação
      //    perdida bloquearia quem pagou. Com a conta de cada linha: a
      //    mensalidade mora onde a matrícula nasceu, a avulsa onde ela nasceu.
      const hoje = hojeBrasilia();
      const abertas: Aberta[] = [];
      for (const origem of Object.keys(TABELA) as Origem[]) {
        const linhas = await todasAsLinhas<{ asaas_payment_id: string; status: string; valor: number | string | null; organization_id: string }>((de, ate) => {
          let consulta = admin
            .from(TABELA[origem])
            .select("asaas_payment_id, status, valor, organization_id")
            .not("asaas_payment_id", "is", null)
            .in("status", ["pendente", "atrasado"])
            .lte("vencimento", hoje);
          if (homologacao) consulta = consulta.filter("organization_id", "not.in", homologacao);
          return consulta.order("asaas_payment_id").range(de, ate);
        });
        const contas = origem === "plano" || origem === "avulsa"
          ? await contasDasCobrancas(admin, origem, linhas.map((l) => l.asaas_payment_id))
          : new Map<string, string>();
        for (const l of linhas) {
          abertas.push({
            id: l.asaas_payment_id,
            status: l.status,
            valor: l.valor == null ? null : Number(l.valor),
            origem,
            organization_id: l.organization_id,
            conta_asaas: contas.get(l.asaas_payment_id) ?? null,
          });
        }
      }

      // As assinaturas que o banco conhece (para a órfã), de todas as contas:
      // o id da assinatura não se repete entre contas do Asaas.
      const conhecidas = new Set<string>();
      for (const [tabela, status] of [["aluno_assinaturas", ["ativa", "atrasada"]], ["aluno_matriculas_academia", ["ativa"]]] as const) {
        const linhas = await todasAsLinhas<{ asaas_subscription_id: string }>((de, ate) => {
          let consulta = admin
            .from(tabela)
            .select("asaas_subscription_id")
            .not("asaas_subscription_id", "is", null)
            .in("status", [...status]);
          if (homologacao) consulta = consulta.filter("organization_id", "not.in", homologacao);
          return consulta.order("asaas_subscription_id").range(de, ate);
        });
        for (const l of linhas) conhecidas.add(l.asaas_subscription_id);
      }

      // 2. A conta da ArkeFit, como sempre.
      const r = await varrerConta(ctx, { nome: "arkefit" }, { api, chave }, abertas, conhecidas, inicio);
      naoConferidas += r.naoConferidas;
      orfas.push(...r.orfas);

      // 3. A conta de cada academia que cobra na própria conta (ou já cobrou:
      //    o webhook registrado fica, e a cobrança antiga ainda pode ser
      //    estornada). Uma conta que falha não para as outras: vai para
      //    `falhas`, que vira erro no registro e aviso do Vigia.
      const { data: academias, error: erroAcademias } = await admin
        .from("asaas_webhook_academia")
        .select("organization_id")
        .eq("ambiente", "producao");
      if (erroAcademias) throw new Error(`asaas_webhook_academia: ${erroAcademias.message}`);
      for (const a of academias ?? []) {
        const organizationId = a.organization_id as string;
        if (idsHomologacao.includes(organizationId)) continue;
        if (Date.now() - inicio > ORCAMENTO_MS) {
          ctx.falhas.push(`conta da academia ${organizationId}: sem tempo nesta rodada`);
          continue;
        }
        const { data: chaveAcademia, error: erroChave } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: organizationId });
        if (erroChave || typeof chaveAcademia !== "string" || !chaveCombinaComAmbiente(chaveAcademia, "producao")) {
          ctx.falhas.push(`conta da academia ${organizationId}: sem a chave de produção no cofre`);
          continue;
        }
        try {
          const ra = await varrerConta(ctx, { nome: "academia", organizationId }, { api, chave: chaveAcademia }, abertas, conhecidas, inicio);
          naoConferidas += ra.naoConferidas;
          orfas.push(...ra.orfas);
        } catch (e) {
          ctx.falhas.push(`conta da academia ${organizationId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      console.error("Reconciliação interrompida", resumoDoErro(e));
    }

    if (!erro && ctx.falhas.length > 0) {
      erro = `${ctx.falhas.length} consulta(s) ao Asaas ou reenvio(s) ao webhook falharam: ${ctx.falhas.slice(0, 5).join("; ")}`;
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
      detalhes: {
        divergencias: ctx.divergencias,
        valores: ctx.valores,
        orfas,
        falhas: ctx.falhas,
        nao_conferidas: naoConferidas,
        duracao_ms: Date.now() - inicio,
      },
      erro,
    });
    if (gravacaoError) {
      // Foi exatamente assim que a primeira execução falhou calada (403 por
      // falta de grant na sequência): a varredura respondia 200 e o registro
      // não existia.
      console.error("Reconciliação feita, mas o registro não foi gravado", resumoDoErro(gravacaoError));
    }
    return jsonResponse({ verificadas: ctx.verificadas, divergencias: ctx.divergencias.length, corrigidas, orfas: orfas.slice(0, 50), nao_conferidas: naoConferidas });
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

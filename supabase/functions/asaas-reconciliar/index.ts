import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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
// Pergunta ao Asaas a situação real de cada cobrança e, quando ela diverge do
// banco, **reenvia o evento correspondente ao asaas-webhook**. O efeito no
// banco sai do mesmo código que trata os webhooks de verdade — não existe uma
// segunda implementação de "o que fazer quando confirma" para divergir da
// primeira. O id do evento reenviado é `reconciliacao:<pagamento>:<status>`,
// então a correção aparece no painel de webhooks com origem clara, e reenviar
// a mesma divergência duas vezes não repete o efeito.
//
// Dois modos:
//   - varredura: pg_cron, uma vez por dia, autenticada pelo token do Vault.
//     Confere Método ARKE, plano próprio da academia e cobranças B2B, e lista
//     assinaturas ativas no Asaas que o banco não conhece.
//   - aluno: o botão "Já paguei, verificar novamente" da tela de bloqueio.
//     Confere só a assinatura daquele aluno — o caminho mais curto para quem
//     pagou e ficou bloqueado porque o PAYMENT_CONFIRMED se perdeu.

type PagamentoAsaas = {
  id: string;
  status: string;
  deleted?: boolean;
  subscription?: string | null;
  value?: number;
  dueDate?: string;
  invoiceUrl?: string;
};

// Status do Asaas → evento que o asaas-webhook entende e o status que o banco
// deveria ter depois dele. Status fora da lista (análise de risco, reembolso
// em andamento...) não são reconciliados: são transitórios, e o webhook de
// desfecho resolve.
const MAPA: Record<string, { evento: string; statusBanco: string }> = {
  PENDING: { evento: "PAYMENT_CREATED", statusBanco: "pendente" },
  CONFIRMED: { evento: "PAYMENT_CONFIRMED", statusBanco: "confirmado" },
  RECEIVED: { evento: "PAYMENT_RECEIVED", statusBanco: "confirmado" },
  RECEIVED_IN_CASH: { evento: "PAYMENT_RECEIVED", statusBanco: "confirmado" },
  OVERDUE: { evento: "PAYMENT_OVERDUE", statusBanco: "atrasado" },
  REFUNDED: { evento: "PAYMENT_REFUNDED", statusBanco: "estornado" },
  CHARGEBACK_REQUESTED: { evento: "PAYMENT_CHARGEBACK_REQUESTED", statusBanco: "estornado" },
};

type Divergencia = {
  origem: "metodo" | "plano" | "b2b";
  pagamento: string;
  asaas: string;
  banco: string | null;
  corrigida: boolean;
};

/**
 * Lança em vez de devolver nulo. A primeira versão devolvia nulo, e uma chave
 * inválida no Asaas virava "0 divergências, 0 órfãs, sem erro" — a falha
 * silenciosa que esta função existe para acabar.
 */
async function asaasGet<T>(api: string, chave: string, caminho: string): Promise<T> {
  const resp = await fetch(`${api}${caminho}`, { headers: { access_token: chave } });
  if (!resp.ok) {
    throw new Error(`Asaas respondeu ${resp.status} em ${caminho.split("?")[0]}`);
  }
  return (await resp.json()) as T;
}

async function pagamentosDaAssinatura(api: string, chave: string, assinaturaId: string): Promise<PagamentoAsaas[]> {
  const r = await asaasGet<{ data?: PagamentoAsaas[] }>(
    api,
    chave,
    `/payments?subscription=${encodeURIComponent(assinaturaId)}&limit=100`
  );
  return r.data ?? [];
}

/** Estado que o banco deveria ter para este pagamento, ou nulo se não há o que reconciliar. */
function esperado(p: PagamentoAsaas) {
  if (p.deleted) return { evento: "PAYMENT_DELETED", statusBanco: "estornado" };
  return MAPA[p.status] ?? null;
}

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

/**
 * Confere os pagamentos de uma assinatura contra a tabela local e reenvia o que
 * divergir. Pagamento pendente que o banco não tem também conta: é o caso do
 * PAYMENT_CREATED perdido, que deixaria a rede de segurança sem o que pescar.
 */
async function conferirAssinatura(
  ctx: Contexto,
  origem: "metodo" | "plano",
  assinaturaId: string,
  tabela: "pagamentos" | "mensalidades"
) {
  let noAsaas: PagamentoAsaas[];
  try {
    noAsaas = await pagamentosDaAssinatura(ctx.api, ctx.chave, assinaturaId);
  } catch (e) {
    // Uma assinatura que não respondeu não impede as outras de serem
    // conferidas — mas fica registrada como falha.
    ctx.falhas.push(`${assinaturaId}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (noAsaas.length === 0) return;

  const { data: locais } = await ctx.admin
    .from(tabela)
    .select("asaas_payment_id, status")
    .in("asaas_payment_id", noAsaas.map((p) => p.id));
  const statusLocal = new Map((locais ?? []).map((l) => [l.asaas_payment_id as string, l.status as string]));

  for (const p of noAsaas) {
    ctx.verificadas++;
    const alvo = esperado(p);
    if (!alvo) continue;
    const atual = statusLocal.get(p.id) ?? null;
    // Mensalidade de plano próprio não registra emissão (status NOT NULL, ver
    // asaas-webhook): pendente que falta lá não é divergência.
    if (alvo.statusBanco === "pendente" && (atual !== null || tabela === "mensalidades")) continue;
    if (atual === alvo.statusBanco) continue;

    const corrigida = await reenviarAoWebhook(ctx.supabaseUrl, ctx.segredoWebhook, alvo.evento, p);
    ctx.divergencias.push({ origem, pagamento: p.id, asaas: p.deleted ? "DELETED" : p.status, banco: atual, corrigida });
  }
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

    // A varredura é da produção, e por isso exclui as organizações em trial.
    //
    // Desde 23/09/2026 organização em trial fala com o **sandbox** do Asaas
    // (ver `_shared/asaas.ts`): as assinaturas dela existem lá, não aqui.
    // Perguntar à produção por um id de sandbox devolveria "não encontrado"
    // para toda uma academia de homologação — ruído diário na faixa vermelha
    // da Visão Master, exatamente onde só deveria aparecer problema real.
    //
    // Homologação não precisa de reconciliação automática: ela é exercitada
    // à mão, e a rede de segurança existe para o dinheiro de cliente.
    const { data: emHomologacao } = await admin
      .from("organizations")
      .select("id")
      .eq("status", "trial");
    const idsHomologacao = (emHomologacao ?? []).map((o) => o.id as string);
    const foraDeHomologacao = <T extends { not: (c: string, o: string, v: string) => T }>(consulta: T): T =>
      idsHomologacao.length ? consulta.not("organization_id", "in", `(${idsHomologacao.join(",")})`) : consulta;

    let erro: string | null = null;
    let orfas: { id: string; referencia: string }[] = [];
    try {
      const { data: metodo } = await foraDeHomologacao(
        admin
          .from("aluno_assinaturas")
          .select("asaas_subscription_id")
          .not("asaas_subscription_id", "is", null)
          .in("status", ["ativa", "atrasada"]),
      );
      for (const a of metodo ?? []) await conferirAssinatura(ctx, "metodo", a.asaas_subscription_id as string, "pagamentos");

      const { data: planos } = await foraDeHomologacao(
        admin
          .from("aluno_matriculas_academia")
          .select("asaas_subscription_id")
          .not("asaas_subscription_id", "is", null)
          .eq("status", "ativa"),
      );
      for (const m of planos ?? []) await conferirAssinatura(ctx, "plano", m.asaas_subscription_id as string, "mensalidades");

      // B2B: cobrança avulsa, sem assinatura — confere uma a uma.
      const { data: b2b } = await foraDeHomologacao(
        admin
          .from("cobrancas_b2b")
          .select("asaas_payment_id, status")
          .not("asaas_payment_id", "is", null)
          .in("status", ["pendente", "atrasado"]),
      );
      for (const c of b2b ?? []) {
        let p: PagamentoAsaas;
        try {
          p = await asaasGet<PagamentoAsaas>(api, chave, `/payments/${encodeURIComponent(c.asaas_payment_id as string)}`);
        } catch (e) {
          ctx.falhas.push(`${c.asaas_payment_id}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        ctx.verificadas++;
        const alvo = esperado(p);
        if (!alvo || alvo.statusBanco === "pendente" || alvo.statusBanco === c.status) continue;
        const corrigida = await reenviarAoWebhook(supabaseUrl, segredoWebhook, alvo.evento, p);
        ctx.divergencias.push({ origem: "b2b", pagamento: p.id, asaas: p.status, banco: c.status as string, corrigida });
      }

      // Assinatura ativa no Asaas que o banco não conhece: cobra o aluno sem
      // ninguém ver. Não se corrige sozinha — pode ser do plano próprio, de
      // outro valor —, então vai para o registro e para a Visão Master.
      const conhecidas = new Set([
        ...(metodo ?? []).map((a) => a.asaas_subscription_id),
        ...(planos ?? []).map((m) => m.asaas_subscription_id),
      ]);
      let offset = 0;
      for (;;) {
        const pagina = await asaasGet<{ data?: { id: string; externalReference?: string }[]; hasMore?: boolean }>(
          api,
          chave,
          `/subscriptions?status=ACTIVE&limit=100&offset=${offset}`
        );
        for (const s of pagina.data ?? []) {
          const ref = s.externalReference ?? "";
          if ((ref.startsWith("metodo:") || ref.startsWith("plano:")) && !conhecidas.has(s.id)) {
            orfas.push({ id: s.id, referencia: ref });
          }
        }
        if (!pagina.hasMore) break;
        offset += 100;
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      console.error("Reconciliação interrompida", erro);
    }

    if (!erro && ctx.falhas.length > 0) {
      erro = `${ctx.falhas.length} consulta(s) ao Asaas falharam: ${ctx.falhas.slice(0, 5).join("; ")}`;
    }
    const corrigidas = ctx.divergencias.filter((d) => d.corrigida).length;
    const { error: gravacaoError } = await admin.from("reconciliacoes_asaas").insert({
      modo: "varredura",
      cobrancas_verificadas: ctx.verificadas,
      divergencias: ctx.divergencias.length,
      corrigidas,
      assinaturas_orfas: orfas.length,
      detalhes: { divergencias: ctx.divergencias, orfas, falhas: ctx.falhas },
      erro,
    });
    if (gravacaoError) {
      // Foi exatamente assim que a primeira execução falhou calada (403 por
      // falta de grant na sequência): a varredura respondia 200 e o registro
      // não existia.
      console.error("Reconciliação feita, mas o registro não foi gravado", gravacaoError.code, gravacaoError.message);
    }
    orfas = orfas.slice(0, 50);
    return jsonResponse({ verificadas: ctx.verificadas, divergencias: ctx.divergencias.length, corrigidas, orfas });
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

  await conferirAssinatura(ctx, "metodo", assinatura.asaas_subscription_id, "pagamentos");
  if (ctx.falhas.length > 0) {
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

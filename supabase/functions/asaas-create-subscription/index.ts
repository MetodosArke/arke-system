import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type CreateSubscriptionPayload = {
  aluno_id: string;
  valor_cobrado: number;
};

// Cria (ou substitui) a assinatura recorrente do aluno no Asaas, com split
// automático: o valor cobrado do aluno é dividido entre o repasse de
// atacado à ARKE (custo do nivel_atacado do aluno) e o valor líquido que
// fica com a academia, via wallet_id configurada em `organizations`.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const asaasApiKey = Deno.env.get("ASAAS_API_KEY");
  const asaasApiUrl = Deno.env.get("ASAAS_API_URL") ?? "https://api.asaas.com/v3";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  if (!asaasApiKey) {
    return jsonResponse(
      { error: "ASAAS_API_KEY não configurada. Configure o secret no projeto Supabase antes de usar o split de pagamento." },
      500
    );
  }

  try {
    const { aluno_id, valor_cobrado }: CreateSubscriptionPayload = await req.json();
    if (!aluno_id || !valor_cobrado || valor_cobrado <= 0) {
      return jsonResponse({ error: "aluno_id e valor_cobrado (> 0) são obrigatórios." }, 400);
    }

    // Cliente com o JWT do chamador: a leitura abaixo só funciona se o
    // usuário for staff da organização do aluno (RLS de `alunos`/`organizations`).
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: aluno, error: alunoError } = await asUser
      .from("alunos")
      .select("id, organization_id, nivel_atacado, user_id, metodo_arke_status")
      .eq("id", aluno_id)
      .single();

    if (alunoError || !aluno) {
      return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);
    }

    // A adesão ao Método é o que autoriza a cobrança. `nivel_atacado` fica
    // preenchido mesmo em aluno `sem_adesao`, então usá-lo sozinho permitia
    // emitir assinatura — e liquidar o repasse de atacado à ARKE — de um
    // produto não contratado.
    //
    // A checagem vem antes de qualquer chamada ao Asaas de propósito: existe
    // a mesma guarda no banco (trigger trg_assinatura_exige_adesao), mas ela
    // só dispararia depois da assinatura já ter sido criada lá, deixando
    // órfão no gateway.
    if (aluno.metodo_arke_status !== "ativo") {
      return jsonResponse(
        {
          error:
            "Este aluno não tem adesão ativa ao Método ARKE. Ative a adesão (ou inicie um trial) antes de gerar a cobrança.",
        },
        422
      );
    }

    const { data: org, error: orgError } = await asUser
      .from("organizations")
      .select("id, nome, asaas_wallet_id")
      .eq("id", aluno.organization_id)
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: "Organização não encontrada." }, 404);
    }
    if (!org.asaas_wallet_id) {
      return jsonResponse(
        { error: "A academia ainda não configurou a wallet do Asaas (Organização > Split de Pagamento)." },
        422
      );
    }

    const { data: profile } = await asUser
      .from("profiles")
      .select("full_name")
      .eq("user_id", aluno.user_id)
      .maybeSingle();

    const { data: planoAtacado, error: planoError } = await asUser
      .from("planos_atacado")
      .select("custo_mensal")
      .eq("id", aluno.nivel_atacado)
      .single();

    if (planoError || !planoAtacado) {
      return jsonResponse({ error: "Nível de atacado do aluno inválido." }, 422);
    }

    // Período de testes: o prazo mora no banco (public.arke_trial_dias),
    // que também alimenta o trial das organizações e o default de
    // aluno_assinaturas.trial_fim. Ler daqui evita que o gateway continue
    // emitindo com 15 dias depois de alguém mudar a política no SQL.
    const { data: trialDias, error: trialError } = await asUser.rpc("arke_trial_dias");
    if (trialError || typeof trialDias !== "number") {
      console.error("Falha ao ler o prazo de trial", trialError);
      return jsonResponse({ error: "Não foi possível determinar o período de testes." }, 500);
    }
    const trialFim = new Date(Date.now() + trialDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const valorRepasseArke = Number(planoAtacado.custo_mensal);
    const valorLiquidoAcademia = Number(valor_cobrado) - valorRepasseArke;

    if (valorLiquidoAcademia < 0) {
      return jsonResponse(
        { error: `O valor cobrado (R$ ${valor_cobrado}) é menor que o custo de atacado ARKE (R$ ${valorRepasseArke}).` },
        422
      );
    }

    // --- Chamada ao Asaas: cria (ou reaproveita) o customer e a assinatura ---
    const asaasHeaders = {
      "Content-Type": "application/json",
      access_token: asaasApiKey,
    };

    const customerResp = await fetch(`${asaasApiUrl}/customers`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        name: profile?.full_name ?? "Aluno ARKE",
        externalReference: aluno.id,
      }),
    });
    const customer = await customerResp.json();
    if (!customerResp.ok) {
      console.error("Asaas customer error", customer);
      return jsonResponse({ error: "Falha ao criar cliente no Asaas.", detalhe: customer }, 502);
    }

    const subscriptionResp = await fetch(`${asaasApiUrl}/subscriptions`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED",
        value: valor_cobrado,
        cycle: "MONTHLY",
        // Sem nextDueDate o Asaas emite a primeira fatura para hoje e o
        // trial não existe na prática. Vencendo no fim do trial, o aluno usa
        // o período inteiro e só depois entra o ciclo mensal.
        nextDueDate: trialFim,
        description: `ARKE — ${org.nome} — nível ${aluno.nivel_atacado} (trial de ${trialDias} dias)`,
        externalReference: aluno.id,
        split: [
          {
            walletId: org.asaas_wallet_id,
            fixedValue: valorLiquidoAcademia,
          },
        ],
      }),
    });
    const subscription = await subscriptionResp.json();
    if (!subscriptionResp.ok) {
      console.error("Asaas subscription error", subscription);
      return jsonResponse({ error: "Falha ao criar assinatura no Asaas.", detalhe: subscription }, 502);
    }

    // --- Persistência (service role: grava independente de RLS, já validamos acima) ---
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: assinatura, error: upsertError } = await admin
      .from("aluno_assinaturas")
      .upsert(
        {
          organization_id: aluno.organization_id,
          aluno_id: aluno.id,
          nivel_atacado: aluno.nivel_atacado,
          valor_cobrado,
          // 'ativa' durante o trial de propósito: o acesso do aluno precisa
          // estar liberado justamente para ele testar. O que o trial adia é
          // a cobrança, não o acesso.
          status: "ativa",
          trial_fim: trialFim,
          asaas_subscription_id: subscription.id,
          proxima_cobranca: subscription.nextDueDate ?? trialFim,
        },
        { onConflict: "aluno_id" }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("Erro ao gravar assinatura", upsertError);
      return jsonResponse({ error: "Assinatura criada no Asaas, mas falhou ao gravar no banco." }, 500);
    }

    return jsonResponse({ assinatura, asaas_subscription_id: subscription.id });
  } catch (error) {
    console.error("asaas-create-subscription error", error);
    return jsonResponse({ error: "Erro inesperado ao criar assinatura." }, 500);
  }
});

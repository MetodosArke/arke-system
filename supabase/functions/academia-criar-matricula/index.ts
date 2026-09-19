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

type CreateMatriculaPayload = {
  aluno_id: string;
  plano_id: string;
  valor_cobrado?: number;
  dia_vencimento: number;
};

const CICLO_ASAAS: Record<string, string> = {
  mensal: "MONTHLY",
  trimestral: "QUARTERLY",
  semestral: "SEMIANNUALLY",
  anual: "YEARLY",
};

// Matricula o aluno num plano próprio da academia e cria a assinatura
// recorrente no Asaas — mesmo mecanismo do fluxo de adesão ao Método
// ARKE (asaas-create-subscription): a academia recebe a mensalidade
// menos uma taxinha de processamento (config global em
// plataforma_config, editável pelo Super Admin) que cobre o custo real
// que o Asaas cobra da ARKE.
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
    return jsonResponse({ error: "ASAAS_API_KEY não configurada." }, 500);
  }

  try {
    const payload: Partial<CreateMatriculaPayload> = await req.json();
    const alunoId = payload.aluno_id;
    const planoId = payload.plano_id;
    const diaVencimento = payload.dia_vencimento;

    if (!alunoId || !planoId) {
      return jsonResponse({ error: "aluno_id e plano_id são obrigatórios." }, 400);
    }
    if (!diaVencimento || diaVencimento < 1 || diaVencimento > 28) {
      return jsonResponse({ error: "dia_vencimento deve estar entre 1 e 28." }, 400);
    }

    // Cliente com o JWT do chamador: só segue se o usuário for staff da
    // organização do aluno (RLS de alunos/planos_academia/organizations).
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: aluno, error: alunoError } = await asUser
      .from("alunos")
      .select("id, organization_id, user_id")
      .eq("id", alunoId)
      .single();
    if (alunoError || !aluno) {
      return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);
    }

    const { data: plano, error: planoError } = await asUser
      .from("planos_academia")
      .select("id, nome, periodicidade, valor, ativo")
      .eq("id", planoId)
      .single();
    if (planoError || !plano) {
      return jsonResponse({ error: "Plano não encontrado." }, 404);
    }
    if (!plano.ativo) {
      return jsonResponse({ error: "Este plano está inativo." }, 422);
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

    const valorCobrado = payload.valor_cobrado && payload.valor_cobrado > 0 ? payload.valor_cobrado : Number(plano.valor);

    // A partir daqui usa o client de service_role: gestor não tem (nem
    // deveria ter) acesso de leitura a plataforma_config (RLS só libera
    // admin_arke) — já validamos acima que ele é staff da organização
    // do aluno, então seguir com privilégio elevado aqui é seguro.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Taxa de processamento (config global, editável pelo Super Admin em
    // Configurações da Plataforma) — cobre o custo real que o Asaas cobra
    // da ARKE, retido via split no momento da cobrança.
    const { data: configTaxas } = await admin
      .from("plataforma_config")
      .select("chave, valor")
      .in("chave", ["taxa_processamento_percentual", "taxa_processamento_fixa"]);
    const taxaPercentual = Number(configTaxas?.find((c) => c.chave === "taxa_processamento_percentual")?.valor ?? 0);
    const taxaFixa = Number(configTaxas?.find((c) => c.chave === "taxa_processamento_fixa")?.valor ?? 0);
    const valorRepasseArke = Math.round((valorCobrado * (taxaPercentual / 100) + taxaFixa) * 100) / 100;
    const valorLiquidoAcademia = Math.round((valorCobrado - valorRepasseArke) * 100) / 100;
    if (valorLiquidoAcademia < 0) {
      return jsonResponse({ error: "O valor cobrado é menor que a taxa de processamento da plataforma." }, 422);
    }

    const { data: profile } = await asUser.from("profiles").select("full_name").eq("user_id", aluno.user_id).maybeSingle();

    // --- Asaas: cria (ou reaproveita) o customer e a assinatura ---
    const asaasHeaders = { "Content-Type": "application/json", access_token: asaasApiKey };

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

    const hoje = new Date();
    const proximoVencimento = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
    if (proximoVencimento < hoje) proximoVencimento.setMonth(proximoVencimento.getMonth() + 1);

    const subscriptionResp = await fetch(`${asaasApiUrl}/subscriptions`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED",
        value: valorCobrado,
        cycle: CICLO_ASAAS[plano.periodicidade] ?? "MONTHLY",
        nextDueDate: proximoVencimento.toISOString().slice(0, 10),
        description: `${org.nome} — ${plano.nome}`,
        externalReference: aluno.id,
        // A academia recebe o valor líquido (mensalidade menos a taxa de
        // processamento); o restante fica retido pela ARKE, mesmo
        // mecanismo de split usado na assinatura do Método ARKE.
        split: [{ walletId: org.asaas_wallet_id, fixedValue: valorLiquidoAcademia }],
      }),
    });
    const subscription = await subscriptionResp.json();
    if (!subscriptionResp.ok) {
      console.error("Asaas subscription error", subscription);
      return jsonResponse({ error: "Falha ao criar assinatura no Asaas.", detalhe: subscription }, 502);
    }

    // --- Persistência (service role, client já criado acima) ---
    const { data: matriculaAtiva } = await admin
      .from("aluno_matriculas_academia")
      .select("id")
      .eq("aluno_id", alunoId)
      .eq("status", "ativa")
      .maybeSingle();
    if (matriculaAtiva) {
      return jsonResponse({ error: "Este aluno já tem uma matrícula ativa. Cancele/pause a atual antes de criar outra." }, 409);
    }

    const { data: matricula, error: insertError } = await admin
      .from("aluno_matriculas_academia")
      .insert({
        organization_id: aluno.organization_id,
        aluno_id: aluno.id,
        plano_id: plano.id,
        valor_cobrado: valorCobrado,
        valor_repasse_arke: valorRepasseArke,
        valor_liquido_academia: valorLiquidoAcademia,
        dia_vencimento: diaVencimento,
        asaas_customer_id: customer.id,
        asaas_subscription_id: subscription.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao gravar matrícula", insertError);
      return jsonResponse({ error: "Assinatura criada no Asaas, mas falhou ao gravar a matrícula." }, 500);
    }

    return jsonResponse({ matricula, asaas_subscription_id: subscription.id });
  } catch (error) {
    console.error("academia-criar-matricula error", error);
    return jsonResponse({ error: "Erro inesperado ao criar matrícula." }, 500);
  }
});

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

// --- Asaas: customer e assinatura sem duplicar -------------------------------
//
// Duplicado de propósito em asaas-create-subscription e academia-criar-matricula:
// edge function não compartilha código com as outras sem um _shared/ que o
// deploy teria de carregar junto, e o projeto preferiu a cópia explícita.
//
// Por que existe: as duas funções faziam POST /customers e POST /subscriptions
// a cada chamada. Dois defeitos saíam daí.
//
//   1. O Asaas exige `cpfCnpj` para criar a assinatura (o customer nasce sem,
//      visto no sandbox), e ele não era enviado — a criação falharia antes de
//      qualquer cobrança nascer. (Até 21/09/2026 nenhuma assinatura de aluno
//      tinha sido criada pelo ARKE.)
//   2. Nada impedia duas assinaturas para o mesmo aluno. O caminho mais curto
//      estava na própria função: criou no Asaas, falhou ao gravar no banco, a
//      tela continua oferecendo "Tentar cobrar" — e a primeira assinatura fica
//      órfã, cobrando o aluno todo mês sem ninguém ver.
//
// A resposta é tornar a operação idempotente pelo `externalReference`.

type RespostaAsaas<T> = { ok: boolean; status: number; corpo: T & { errors?: { code?: string; description?: string }[] } };

async function chamarAsaas<T>(url: string, init: RequestInit): Promise<RespostaAsaas<T>> {
  const resp = await fetch(url, init);
  let corpo: unknown = {};
  try {
    corpo = await resp.json();
  } catch {
    // corpo vazio ou não-JSON: fica {}.
  }
  return { ok: resp.ok, status: resp.status, corpo: corpo as RespostaAsaas<T>["corpo"] };
}

function descricaoErroAsaas(corpo: { errors?: { description?: string }[] }): string | null {
  return corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;
}

/**
 * Reaproveita o customer do aluno antes de criar outro: primeiro pelo id do
 * aluno (`externalReference`), depois pelo CPF — a mesma pessoa pode ser aluna
 * de duas academias, e para o Asaas ela é um cliente só.
 */
async function obterOuCriarCustomer(
  api: string,
  headers: Record<string, string>,
  dados: { alunoId: string; nome: string; cpf: string; telefone: string | null }
): Promise<{ id: string } | { erro: string }> {
  for (const filtro of [`externalReference=${encodeURIComponent(dados.alunoId)}`, `cpfCnpj=${dados.cpf}`]) {
    const busca = await chamarAsaas<{ data?: { id: string; deleted?: boolean }[] }>(`${api}/customers?${filtro}`, {
      headers,
    });
    const existente = busca.ok ? busca.corpo.data?.find((c) => !c.deleted) : undefined;
    if (existente) return { id: existente.id };
  }

  const criado = await chamarAsaas<{ id: string }>(`${api}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: dados.nome,
      cpfCnpj: dados.cpf,
      mobilePhone: dados.telefone ?? undefined,
      externalReference: dados.alunoId,
    }),
  });
  if (!criado.ok) {
    console.error("Asaas: falha ao criar customer", criado.status, criado.corpo?.errors);
    return { erro: descricaoErroAsaas(criado.corpo) ?? "Falha ao criar o cliente no Asaas." };
  }
  return { id: criado.corpo.id };
}

/** Assinatura ativa com esta referência no Asaas, se houver. */
async function assinaturaAtivaNoAsaas(
  api: string,
  headers: Record<string, string>,
  referencia: string
): Promise<{ id: string; value: number; nextDueDate?: string; split?: { fixedValue?: number | null }[] } | null> {
  const busca = await chamarAsaas<{ data?: { id: string; value: number; nextDueDate?: string; split?: { fixedValue?: number | null }[] }[] }>(
    `${api}/subscriptions?externalReference=${encodeURIComponent(referencia)}&status=ACTIVE`,
    { headers }
  );
  return busca.ok ? busca.corpo.data?.[0] ?? null : null;
}

/**
 * Parte da ArkeFit numa assinatura já existente no Asaas: o valor menos o split
 * da academia. Sem split na resposta, nula — quem chama usa o calculado, em vez
 * de contar o valor inteiro como repasse.
 */
function repasseDoSplit(assinatura: { value: number; split?: { fixedValue?: number | null }[] }): number | null {
  if (!assinatura.split?.length) return null;
  const academia = (assinatura.split ?? []).reduce((soma, s) => soma + Number(s.fixedValue ?? 0), 0);
  return Math.round((Number(assinatura.value) - academia) * 100) / 100;
}

/**
 * Hoje no fuso de Brasília. Em UTC, depois das 21h a data já é a de amanhã, e
 * a primeira cobrança venceria um dia depois da matrícula.
 */
function hojeEmBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

// Cria a assinatura recorrente do aluno no Asaas, com split
// automático: o valor cobrado do aluno é dividido entre o repasse de
// atacado à ARKE (custo do nivel_atacado + taxa de processamento) e o valor líquido que
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
            "Este aluno não tem adesão ativa ao Método ARKE. Ative a adesão antes de gerar a cobrança.",
        },
        422
      );
    }

    // Assinatura ativa já registrada: recusa antes de tocar no gateway. Sem
    // isto, cada chamada criava uma assinatura nova e a anterior seguia
    // cobrando no Asaas, órfã. Trial (sem id no Asaas) não conta: é
    // justamente o caso de converter o trial em assinatura paga.
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: assinaturaAtual } = await admin
      .from("aluno_assinaturas")
      .select("status, asaas_subscription_id")
      .eq("aluno_id", aluno.id)
      .maybeSingle();
    if (
      assinaturaAtual?.asaas_subscription_id &&
      ["ativa", "atrasada"].includes(assinaturaAtual.status)
    ) {
      return jsonResponse(
        { error: "Este aluno já tem assinatura do Método ARKE ativa. Não é preciso gerar outra." },
        409
      );
    }

    const { data: org, error: orgError } = await asUser
      .from("organizations")
      .select("id, nome, asaas_wallet_id, onboarding_completed, status")
      .eq("id", aluno.organization_id)
      .single();

    if (orgError || !org) {
      return jsonResponse({ error: "Organização não encontrada." }, 404);
    }
    if (!org.asaas_wallet_id) {
      return jsonResponse(
        { error: "A academia ainda não configurou a conta de recebimentos no Asaas (Onboarding → Recebimentos)." },
        422
      );
    }
    // D5: cobrança de aluno só com o onboarding da academia concluído
    // (organização em trial é homologação e passa).
    if (!org.onboarding_completed && org.status !== "trial") {
      return jsonResponse(
        { error: "Conclua o onboarding da academia (Painel → Onboarding) antes de cobrar alunos pelo ARKE." },
        422
      );
    }

    const { data: profile } = await asUser
      .from("profiles")
      .select("full_name, cpf, phone")
      .eq("user_id", aluno.user_id)
      .maybeSingle();

    // O Asaas não cria cliente sem CPF. Melhor dizer isso agora, com o
    // caminho para resolver, do que devolver o erro do gateway lá adiante.
    const cpf = somenteDigitos(profile?.cpf);
    if (cpf.length !== 11) {
      return jsonResponse(
        {
          error:
            "Cadastre o CPF do aluno (ficha do aluno) antes de gerar a cobrança — o Asaas exige CPF para emitir a assinatura.",
        },
        422
      );
    }

    const { data: planoAtacado, error: planoError } = await asUser
      .from("planos_atacado")
      .select("custo_mensal")
      .eq("id", aluno.nivel_atacado)
      .single();

    if (planoError || !planoAtacado) {
      return jsonResponse({ error: "Nível de atacado do aluno inválido." }, 422);
    }

    // A assinatura vale do dia em que é criada: a primeira cobrança vence no
    // ato. Até 21/09/2026 ela vencia no fim de um "trial" de 15 dias — um
    // período grátis para todo aluno, quando trial é só ferramenta de teste
    // atribuída pelo Super Admin (iniciar_trial_metodo_arke, sem Asaas).
    const primeiroVencimento = hojeEmBrasilia();

    // A taxa do Asaas sai da parte da ArkeFit (a academia recebe o split em
    // valor fixo), então ela entra no preço de atacado: custo do nível + taxa
    // de processamento sobre o valor cobrado — a mesma taxa configurável que a
    // mensalidade de plano próprio já usa. Sobre o valor cobrado, e não fixa,
    // porque a academia define o varejo e a parte percentual acompanha.
    const { data: taxaProcessamento, error: taxaError } = await admin.rpc("arke_taxa_processamento", {
      _valor: Number(valor_cobrado),
    });
    if (taxaError || taxaProcessamento === null || Number.isNaN(Number(taxaProcessamento))) {
      console.error("Falha ao calcular a taxa de processamento", taxaError);
      return jsonResponse({ error: "Não foi possível calcular o repasse ARKE." }, 500);
    }
    const custoAtacado = Number(planoAtacado.custo_mensal);
    const valorRepasseArke = Math.round((custoAtacado + Number(taxaProcessamento)) * 100) / 100;
    const valorLiquidoAcademia = Math.round((Number(valor_cobrado) - valorRepasseArke) * 100) / 100;

    if (valorLiquidoAcademia < 0) {
      return jsonResponse(
        {
          error: `O valor cobrado (R$ ${valor_cobrado}) é menor que o repasse ARKE (R$ ${valorRepasseArke.toFixed(2)}: atacado R$ ${custoAtacado.toFixed(2)} + taxa de processamento R$ ${Number(taxaProcessamento).toFixed(2)}).`,
        },
        422
      );
    }

    // --- Chamada ao Asaas: cria (ou reaproveita) o customer e a assinatura ---
    const asaasHeaders = {
      "Content-Type": "application/json",
      access_token: asaasApiKey,
    };

    const customer = await obterOuCriarCustomer(asaasApiUrl, asaasHeaders, {
      alunoId: aluno.id,
      nome: profile?.full_name ?? "Aluno ARKE",
      cpf,
      telefone: somenteDigitos(profile?.phone) || null,
    });
    if ("erro" in customer) {
      return jsonResponse({ error: customer.erro }, 502);
    }

    // Adota em vez de duplicar: se o Asaas já tem assinatura ativa do Método
    // para este aluno — o caso de ter criado lá e falhado ao gravar aqui —,
    // é ela que vale. O prefixo separa do plano próprio da academia, que usa
    // `plano:` para o mesmo aluno.
    const referencia = `metodo:${aluno.id}`;
    const jaExistente = await assinaturaAtivaNoAsaas(asaasApiUrl, asaasHeaders, referencia);

    const subscriptionResp = jaExistente ? null : await fetch(`${asaasApiUrl}/subscriptions`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED",
        value: valor_cobrado,
        cycle: "MONTHLY",
        nextDueDate: primeiroVencimento,
        description: `ARKE — ${org.nome} — nível ${aluno.nivel_atacado}`,
        externalReference: referencia,
        split: [
          {
            walletId: org.asaas_wallet_id,
            fixedValue: valorLiquidoAcademia,
          },
        ],
      }),
    });
    let subscription: { id: string; value?: number; nextDueDate?: string };
    if (jaExistente) {
      subscription = jaExistente;
    } else {
      const corpo = await subscriptionResp!.json();
      if (!subscriptionResp!.ok) {
        console.error("Asaas: falha ao criar assinatura", subscriptionResp!.status, corpo?.errors);
        return jsonResponse(
          { error: descricaoErroAsaas(corpo) ?? "Falha ao criar assinatura no Asaas." },
          502
        );
      }
      subscription = corpo;
    }

    // --- Persistência (service role: grava independente de RLS, já validamos acima) ---
    const { data: assinatura, error: upsertError } = await admin
      .from("aluno_assinaturas")
      .upsert(
        {
          organization_id: aluno.organization_id,
          aluno_id: aluno.id,
          nivel_atacado: aluno.nivel_atacado,
          valor_cobrado: jaExistente ? Number(jaExistente.value) : valor_cobrado,
          // Travado aqui porque o split fica fixo no Asaas: o webhook usa este
          // valor, não o custo ou a taxa do dia. Na adoção, vale o split que
          // já está lá.
          valor_repasse_arke: (jaExistente && repasseDoSplit(jaExistente)) ?? valorRepasseArke,
          status: "ativa",
          // Convertendo um trial em assinatura paga, o prazo dele não vale mais.
          trial_fim: null,
          asaas_subscription_id: subscription.id,
          proxima_cobranca: subscription.nextDueDate ?? primeiroVencimento,
        },
        { onConflict: "aluno_id" }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("Erro ao gravar assinatura", upsertError);
      return jsonResponse(
        {
          error:
            "A assinatura foi criada no Asaas, mas não foi gravada aqui. Tente de novo: a assinatura já criada será reaproveitada, sem duplicar.",
        },
        500
      );
    }

    return jsonResponse({ assinatura, asaas_subscription_id: subscription.id });
  } catch (error) {
    console.error("asaas-create-subscription error", error);
    return jsonResponse({ error: "Erro inesperado ao criar assinatura." }, 500);
  }
});

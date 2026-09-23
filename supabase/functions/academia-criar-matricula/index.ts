import { createClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";

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
};

/**
 * Hoje no fuso de Brasília. Em UTC, depois das 21h a data já é a de amanhã, e
 * a primeira mensalidade venceria um dia depois da matrícula.
 */
function hojeEmBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

const CICLO_ASAAS: Record<string, string> = {
  mensal: "MONTHLY",
  trimestral: "QUARTERLY",
  semestral: "SEMIANNUALLY",
  anual: "YEARLY",
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
  // Filtro vazio no Asaas não filtra: `GET /customers?cpfCnpj=` devolve a
  // lista inteira da conta, e a busca abaixo adota o primeiro resultado. Um
  // CPF em branco faria a mensalidade nascer grudada no customer de **outra
  // pessoa**. O chamador já exige CPF, mas isso depende de ele lembrar.
  if (dados.cpf.length !== 11 || !dados.alunoId) {
    return { erro: "CPF do aluno ausente ou inválido: o Asaas exige CPF para emitir a cobrança." };
  }

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
): Promise<{ id: string; value: number; nextDueDate?: string } | null> {
  const busca = await chamarAsaas<{ data?: { id: string; value: number; nextDueDate?: string }[] }>(
    `${api}/subscriptions?externalReference=${encodeURIComponent(referencia)}&status=ACTIVE`,
    { headers }
  );
  return busca.ok ? busca.corpo.data?.[0] ?? null : null;
}

function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}


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

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<CreateMatriculaPayload> = await req.json();
    const alunoId = payload.aluno_id;
    const planoId = payload.plano_id;

    if (!alunoId || !planoId) {
      return jsonResponse({ error: "aluno_id e plano_id são obrigatórios." }, 400);
    }

    // Cliente com o JWT do chamador: só segue se o usuário for staff da
    // organização do aluno (RLS de alunos/planos_academia/organizations).
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Quem está matriculando (pra comissão de venda — ver
    // gerar_comissao_se_configurada) — mesmo padrão de extração de
    // identidade usado em convidar-membro.
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

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

    // Organização em trial é homologação e fala com o sandbox do Asaas.
    const ambiente = ambienteAsaas(org.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const asaasApiUrl = ambiente.api;
    const asaasApiKey = ambiente.chave;

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

    const { data: profile } = await asUser
      .from("profiles")
      .select("full_name, cpf, phone")
      .eq("user_id", aluno.user_id)
      .maybeSingle();

    // O Asaas não cria cliente sem CPF — dizer agora, com o caminho.
    const cpf = somenteDigitos(profile?.cpf);
    if (cpf.length !== 11) {
      return jsonResponse(
        {
          error:
            "Cadastre o CPF do aluno (ficha do aluno) antes de criar a matrícula — o Asaas exige CPF para emitir a cobrança.",
        },
        422
      );
    }

    // Matrícula ativa: recusa ANTES de tocar no gateway. A versão anterior
    // conferia isto depois de criar a assinatura no Asaas — o 409 voltava,
    // e a assinatura recém-criada ficava lá, órfã, cobrando o aluno.
    const { data: matriculaAtiva } = await admin
      .from("aluno_matriculas_academia")
      .select("id")
      .eq("aluno_id", alunoId)
      .eq("status", "ativa")
      .maybeSingle();
    if (matriculaAtiva) {
      return jsonResponse({ error: "Este aluno já tem uma matrícula ativa. Cancele/pause a atual antes de criar outra." }, 409);
    }

    // --- Asaas: cria (ou reaproveita) o customer e a assinatura ---
    const asaasHeaders = { "Content-Type": "application/json", access_token: asaasApiKey };

    const customer = await obterOuCriarCustomer(asaasApiUrl, asaasHeaders, {
      alunoId: aluno.id,
      nome: profile?.full_name ?? "Aluno ARKE",
      cpf,
      telefone: somenteDigitos(profile?.phone) || null,
    });
    if ("erro" in customer) {
      return jsonResponse({ error: customer.erro }, 502);
    }

    // Assinatura de plano ativa no Asaas sem matrícula ativa aqui é órfã
    // (criou lá e falhou ao gravar, ou foi cancelada só de um lado).
    // Diferente do Método, não se adota: pode ser de outro plano ou outro
    // valor, e adotar esconderia o problema. Recusa e diz onde olhar.
    const referencia = `plano:${aluno.id}`;
    const orfa = await assinaturaAtivaNoAsaas(asaasApiUrl, asaasHeaders, referencia);
    if (orfa) {
      console.error("Assinatura de plano órfã no Asaas", orfa.id, "aluno", aluno.id);
      return jsonResponse(
        {
          error:
            `Já existe uma assinatura ativa no Asaas para este aluno (${orfa.id}) sem matrícula correspondente no ARKE. ` +
            "Cancele-a no Asaas antes de criar a nova, para o aluno não ser cobrado duas vezes.",
        },
        409
      );
    }

    // A matrícula vale do dia em que é feita: a primeira mensalidade vence no
    // ato e as seguintes no mesmo dia do mês (o Asaas ajusta 29–31 nos meses
    // mais curtos). Antes a academia escolhia o dia e a primeira cobrança caía
    // no próximo — até quatro semanas de plano sem cobrança.
    const primeiroVencimento = hojeEmBrasilia();
    const diaVencimento = Number(primeiroVencimento.slice(8, 10));

    const subscriptionResp = await fetch(`${asaasApiUrl}/subscriptions`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: customer.id,
        billingType: "UNDEFINED",
        value: valorCobrado,
        cycle: CICLO_ASAAS[plano.periodicidade] ?? "MONTHLY",
        nextDueDate: primeiroVencimento,
        description: `${org.nome} — ${plano.nome}`,
        externalReference: referencia,
        // A academia recebe o valor líquido (mensalidade menos a taxa de
        // processamento); o restante fica retido pela ARKE, mesmo
        // mecanismo de split usado na assinatura do Método ARKE.
        split: [{ walletId: org.asaas_wallet_id, fixedValue: valorLiquidoAcademia }],
      }),
    });
    const subscription = await subscriptionResp.json();
    if (!subscriptionResp.ok) {
      console.error("Asaas: falha ao criar assinatura", subscriptionResp.status, subscription?.errors);
      return jsonResponse(
        { error: descricaoErroAsaas(subscription) ?? "Falha ao criar assinatura no Asaas." },
        502
      );
    }

    // --- Persistência (service role, client já criado acima) ---

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
        registrado_por: callerId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao gravar matrícula", insertError);
      return jsonResponse(
        {
          error:
            `A assinatura foi criada no Asaas (${subscription.id}), mas a matrícula não foi gravada aqui. ` +
            "Cancele essa assinatura no Asaas antes de tentar de novo, para o aluno não ser cobrado duas vezes.",
        },
        500
      );
    }

    return jsonResponse({ matricula, asaas_subscription_id: subscription.id });
  } catch (error) {
    console.error("academia-criar-matricula error", error);
    return jsonResponse({ error: "Erro inesperado ao criar matrícula." }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Todo erro de negócio (validação, permissão, Asaas) volta com HTTP 200 e
// `{ error }` no corpo — nunca um status não-2xx. supabase-js `functions.invoke`
// só devolve o corpo em `data` numa resposta 2xx; num não-2xx ele descarta o
// corpo e troca `error` por um FunctionsHttpError genérico ("Edge Function
// returned a non-2xx status code"), que era exatamente a mensagem que a UI
// mostrava em vez do motivo real recusado pelo Asaas (ex.: "CPF/CNPJ
// inválido"). O frontend já trata `data.error` como falha (`if (data?.error)
// throw new Error(data.error)`), então HTTP 200 com `error` no corpo é o
// único jeito de a mensagem específica chegar ao toast.
const errorResponse = (mensagem: string, detalhe?: unknown) =>
  new Response(JSON.stringify(detalhe !== undefined ? { error: mensagem, detalhe } : { error: mensagem }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type FormaPagamento = "PIX" | "CREDIT_CARD";
const FORMAS_VALIDAS = new Set<FormaPagamento>(["PIX", "CREDIT_CARD"]);

type EmitirCobrancaPayload = {
  organization_id: string;
  valor: number;
  descricao: string;
  forma_pagamento: FormaPagamento;
};

const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

type AsaasErrorBody = { errors?: { code?: string; description?: string }[] };
type ChamadaAsaas<T> = { ok: true; data: T } | { ok: false; mensagem: string; corpo: unknown };

// Faz a chamada ao Asaas e SEMPRE tenta extrair o corpo JSON (sucesso ou
// erro) dentro de um try/catch — o Asaas normalmente devolve JSON mesmo em
// erro (`{ errors: [{ description }] }`), mas uma falha de rede/gateway
// pode devolver algo que não é JSON válido, e isso não pode derrubar a
// função com uma exceção não tratada. Quando dá erro HTTP, prefixa "Asaas: "
// para deixar claro na UI que a recusa veio do gateway, não do ARKE.
async function chamarAsaas<T>(url: string, options: RequestInit): Promise<ChamadaAsaas<T>> {
  let resp: Response;
  try {
    resp = await fetch(url, options);
  } catch (networkError) {
    console.error("Falha de rede ao chamar o Asaas", networkError);
    return { ok: false, mensagem: "Falha de rede ao comunicar com o Asaas. Tente novamente.", corpo: String(networkError) };
  }

  let corpo: unknown = null;
  try {
    corpo = await resp.json();
  } catch (parseError) {
    console.error("Resposta do Asaas não é JSON válido", parseError);
  }

  if (!resp.ok) {
    const erros = (corpo as AsaasErrorBody | null)?.errors;
    const descricao =
      erros && erros.length > 0
        ? erros.map((e) => e.description).filter(Boolean).join(" ")
        : `O Asaas recusou a requisição (HTTP ${resp.status}).`;
    return { ok: false, mensagem: `Asaas: ${descricao}`, corpo };
  }

  return { ok: true, data: corpo as T };
}

// Módulo Definitivo de Cobrança B2B: a ARKE cobra a própria academia/studio
// (mensalidade SaaS, taxa de implantação etc.) — direção oposta do split
// de aluno em asaas-create-subscription (lá a academia recebe, aqui a
// ARKE recebe o valor inteiro, sem split, na conta dona da ASAAS_API_KEY).
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Sessão inválida. Faça login novamente.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const asaasApiKey = Deno.env.get("ASAAS_API_KEY");
  const asaasApiUrl = Deno.env.get("ASAAS_API_URL") ?? "https://api.asaas.com/v3";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return errorResponse("Configuração do servidor incompleta.");
  }
  if (!asaasApiKey) {
    return errorResponse("ASAAS_API_KEY não configurada. Configure o secret no projeto Supabase antes de emitir cobranças.");
  }

  try {
    const payload: Partial<EmitirCobrancaPayload> = await req.json();
    const organizationId = payload.organization_id?.trim();
    const valor = Number(payload.valor);
    const descricao = payload.descricao?.trim();
    const formaPagamento = payload.forma_pagamento;

    if (!organizationId) return errorResponse("organization_id é obrigatório.");
    if (!Number.isFinite(valor) || valor <= 0) {
      return errorResponse("Valor inválido. Informe um valor maior que zero.");
    }
    if (!descricao) return errorResponse("Descrição / motivo da cobrança é obrigatório.");
    if (!formaPagamento || !FORMAS_VALIDAS.has(formaPagamento)) {
      return errorResponse("Forma de pagamento inválida. Use PIX ou CREDIT_CARD.");
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return errorResponse("Sessão inválida. Faça login novamente.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return errorResponse("Erro ao validar permissões.");
    }
    const callerIsSuperadmin = (callerRoles ?? []).some((r) => r.role === "superadmin");
    if (!callerIsSuperadmin) {
      return errorResponse("Apenas o Super Admin ArkeFit pode emitir cobranças B2B.");
    }

    const { data: org, error: orgError } = await adminClient
      .from("organizations")
      .select("id, nome, cnpj_cpf, telefone, asaas_customer_id_b2b")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) {
      console.error("Error loading organization", orgError);
      return errorResponse("Erro ao carregar a organização.");
    }
    if (!org) return errorResponse("Organização não encontrada.");

    const cnpjCpfLimpo = org.cnpj_cpf ? somenteDigitos(org.cnpj_cpf) : "";
    if (cnpjCpfLimpo.length !== 11 && cnpjCpfLimpo.length !== 14) {
      return errorResponse(
        "Cadastre o CNPJ/CPF da organização (aba Informações) antes de emitir uma cobrança — o Asaas exige o documento fiscal do cliente."
      );
    }

    const telefoneLimpo = org.telefone ? somenteDigitos(org.telefone) : "";
    if (telefoneLimpo.length < 10) {
      return errorResponse(
        "Cadastre um telefone válido da organização (aba Informações) antes de emitir uma cobrança — o Asaas exige um telefone de contato do cliente."
      );
    }

    const asaasHeaders = {
      "Content-Type": "application/json",
      access_token: asaasApiKey,
    };

    // Reaproveita o customer Asaas já criado para essa organização (evita
    // duplicar o mesmo cliente a cada cobrança) — só busca/cria na primeira vez.
    let asaasCustomerId = org.asaas_customer_id_b2b;
    if (!asaasCustomerId) {
      // Antes de criar, busca por CPF/CNPJ — o customer pode já existir no
      // Asaas (criado manualmente, ou por outro fluxo) sem estar salvo aqui;
      // evita duplicar o cadastro do mesmo cliente fiscal.
      const resultadoBusca = await chamarAsaas<{ data?: { id: string }[] }>(
        `${asaasApiUrl}/customers?cpfCnpj=${cnpjCpfLimpo}`,
        { method: "GET", headers: asaasHeaders }
      );
      if (!resultadoBusca.ok) {
        console.error("Asaas customer search error", resultadoBusca.corpo);
        return errorResponse(resultadoBusca.mensagem, resultadoBusca.corpo);
      }

      const customerExistente = resultadoBusca.data.data?.[0];
      if (customerExistente) {
        asaasCustomerId = customerExistente.id;
      } else {
        // E-mail do gestor master como e-mail de contato do customer no
        // Asaas (a organização não tem um e-mail próprio cadastrado — o
        // login do gestor ativo mais antigo é a melhor referência de
        // contato, mesmo padrão já usado em get_superadmin_tenants).
        const { data: gestorMembership } = await adminClient
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", org.id)
          .eq("role", "gestor")
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        let gestorEmail: string | undefined;
        if (gestorMembership) {
          const { data: gestorUser } = await adminClient.auth.admin.getUserById(gestorMembership.user_id);
          gestorEmail = gestorUser?.user?.email;
        }
        if (!gestorEmail) {
          return errorResponse(
            "Não foi possível localizar o e-mail do gestor dessa organização — cadastre um gestor ativo antes de emitir a primeira cobrança."
          );
        }

        const resultadoCustomer = await chamarAsaas<{ id: string }>(`${asaasApiUrl}/customers`, {
          method: "POST",
          headers: asaasHeaders,
          body: JSON.stringify({
            name: org.nome,
            cpfCnpj: cnpjCpfLimpo,
            email: gestorEmail,
            phone: telefoneLimpo,
            mobilePhone: telefoneLimpo,
            externalReference: `org:${org.id}`,
          }),
        });
        if (!resultadoCustomer.ok) {
          console.error("Asaas customer create error", resultadoCustomer.corpo);
          return errorResponse(resultadoCustomer.mensagem, resultadoCustomer.corpo);
        }
        asaasCustomerId = resultadoCustomer.data.id;
      }

      await adminClient.from("organizations").update({ asaas_customer_id_b2b: asaasCustomerId }).eq("id", org.id);
    }

    const resultadoPayment = await chamarAsaas<{ id: string; invoiceUrl?: string }>(`${asaasApiUrl}/payments`, {
      method: "POST",
      headers: asaasHeaders,
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: formaPagamento,
        value: valor,
        dueDate: hojeISO(),
        description: descricao,
        externalReference: `b2b:${org.id}`,
      }),
    });
    if (!resultadoPayment.ok) {
      console.error("Asaas payment error", resultadoPayment.corpo);
      return errorResponse(resultadoPayment.mensagem, resultadoPayment.corpo);
    }
    const payment = resultadoPayment.data;

    let pixCopiaCola: string | null = null;
    let pixQrCodeBase64: string | null = null;
    if (formaPagamento === "PIX") {
      const resultadoPix = await chamarAsaas<{ payload?: string; encodedImage?: string }>(
        `${asaasApiUrl}/payments/${payment.id}/pixQrCode`,
        { method: "GET", headers: asaasHeaders }
      );
      if (resultadoPix.ok) {
        pixCopiaCola = resultadoPix.data.payload ?? null;
        pixQrCodeBase64 = resultadoPix.data.encodedImage ?? null;
      } else {
        // Cobrança já foi criada no Asaas — não falha a operação inteira só
        // porque o QR Code demorou/falhou; o link de pagamento ainda funciona.
        console.error("Asaas pixQrCode error", resultadoPix.corpo);
      }
    }

    const { data: cobranca, error: insertError } = await adminClient
      .from("cobrancas_b2b")
      .insert({
        organization_id: org.id,
        valor,
        descricao,
        forma_pagamento: formaPagamento,
        status: "pendente",
        asaas_customer_id: asaasCustomerId,
        asaas_payment_id: payment.id,
        invoice_url: payment.invoiceUrl ?? null,
        pix_copia_cola: pixCopiaCola,
        pix_qr_code_base64: pixQrCodeBase64,
        criado_por: callerId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao gravar cobranca_b2b", insertError);
      return jsonResponse({
        error: "Cobrança criada no Asaas, mas falhou ao gravar no banco.",
        invoice_url: payment.invoiceUrl ?? null,
        pix_copia_cola: pixCopiaCola,
        pix_qr_code_base64: pixQrCodeBase64,
      });
    }

    return jsonResponse({ cobranca });
  } catch (error) {
    console.error("asaas-emitir-cobranca-b2b error", error);
    return errorResponse("Erro inesperado ao emitir a cobrança.");
  }
});

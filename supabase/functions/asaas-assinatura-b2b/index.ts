import { createClient } from "npm:@supabase/supabase-js@2";
import { criarOuAdotarAssinaturaB2b, garantirClienteB2b, hojeBrasilia } from "./fluxo.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ROTULO_PLANO: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
  custom: "Custom",
  autonomo: "Profissional Autônomo",
};

// Cria (ou adota) a assinatura B2B da academia no Asaas. Chamada pelo painel
// logo depois de concluir o onboarding, e pela Visão Master para academias que
// já estavam no ar. O valor vem do banco (valor_mensal_b2b), nunca do pedido.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const { organization_id: organizationId } = (await req.json()) as { organization_id?: string };
    if (!organizationId) return jsonResponse({ error: "Pedido inválido." }, 400);

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const [{ data: vinculo }, { data: papeis }] = await Promise.all([
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const arkefit = (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
    if (!arkefit && vinculo?.role !== "gestor") {
      return jsonResponse({ error: "Só o gestor da academia ou a ArkeFit criam a mensalidade B2B." }, 403);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("id, nome, razao_social, cnpj_cpf, email_contato, telefone, status, plano_b2b, onboarding_completed, asaas_customer_id_b2b, asaas_subscription_id_b2b")
      .eq("id", organizationId)
      .maybeSingle();

    if (!org) return jsonResponse({ error: "Organização não encontrada." }, 404);
    // Organização em trial é homologação: fala com o sandbox do Asaas.
    const ambiente = ambienteAsaas(org.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const asaasApiUrl = ambiente.api;
    const asaasApiKey = ambiente.chave;


    if (org.asaas_subscription_id_b2b) {
      return jsonResponse({ ok: true, subscription_id: org.asaas_subscription_id_b2b, ja_existia: true });
    }
    // Trial é homologação, nunca oferta: não se cobra.
    if (org.status === "trial") return jsonResponse({ error: "Organização em trial não tem mensalidade B2B." }, 409);
    if (!org.onboarding_completed) {
      return jsonResponse({ error: "A mensalidade começa quando o onboarding da academia é concluído." }, 409);
    }

    const { data: valorBanco } = await admin.rpc("valor_mensal_b2b", { _organization_id: org.id });
    const valor = valorBanco === null || valorBanco === undefined ? null : Number(valorBanco);
    if (!valor || valor <= 0) {
      return jsonResponse(
        { error: "O plano desta academia não tem preço de tabela. A ArkeFit define a mensalidade na Visão Master antes de começar a cobrança." },
        409
      );
    }

    const cpfCnpj = (org.cnpj_cpf ?? "").replace(/\D/g, "");
    const telefone = (org.telefone ?? "").replace(/\D/g, "");
    if (![11, 14].includes(cpfCnpj.length) || telefone.length < 10 || !org.email_contato) {
      return jsonResponse({ error: "Complete CNPJ, celular e e-mail da academia (onboarding → Dados) antes de iniciar a mensalidade." }, 400);
    }

    let customer = org.asaas_customer_id_b2b;
    if (!customer) {
      const c = await garantirClienteB2b(asaasApiUrl, asaasApiKey, {
        orgId: org.id,
        nome: org.razao_social?.trim() || org.nome,
        cpfCnpj,
        email: org.email_contato,
        telefone,
      });
      if (!c.ok) return jsonResponse({ error: c.erro }, 502);
      customer = c.id;
      await admin.from("organizations").update({ asaas_customer_id_b2b: customer }).eq("id", org.id);
    }

    const r = await criarOuAdotarAssinaturaB2b(asaasApiUrl, asaasApiKey, {
      orgId: org.id,
      customer,
      valor,
      descricao: `ARKE — plano ${ROTULO_PLANO[org.plano_b2b] ?? org.plano_b2b}`,
      primeiroVencimento: hojeBrasilia(),
    });
    if (!r.ok) return jsonResponse({ error: r.erro }, 502);

    const { error: erroOrg } = await admin.from("organizations").update({ asaas_subscription_id_b2b: r.id }).eq("id", org.id);
    if (erroOrg) {
      return jsonResponse({ error: "A assinatura foi criada no Asaas, mas não foi possível salvar aqui. Tente de novo: ela será recuperada, não duplicada." }, 500);
    }
    return jsonResponse({
      ok: true,
      subscription_id: r.id,
      adotada: r.adotada,
      valor: r.valor,
      // Adotada com valor diferente do de hoje: alguém mudou o preço no meio.
      valor_divergente: r.adotada && Math.abs(r.valor - valor) > 0.009,
    });
  } catch (erro) {
    console.error("asaas-assinatura-b2b: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

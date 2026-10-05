import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import {
  alterarValorAssinaturaB2b,
  consultarAssinaturaB2b,
  criarOuAdotarAssinaturaB2b,
  garantirClienteB2b,
  hojeBrasilia,
} from "./fluxo.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { servir } from "../_shared/servir.ts";

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
  redes: "Redes",
  custom: "Custom",
  autonomo: "Profissional Autônomo",
};

// Cria (ou adota) a assinatura B2B da academia no Asaas. Chamada pelo painel
// logo depois de concluir o onboarding, e pela Visão Master para academias que
// já estavam no ar. O valor vem do banco (valor_mensal_b2b), nunca do pedido.
//
// Duas ações a mais, só da ArkeFit: `situacao` compara a assinatura no Asaas
// com o valor de hoje, e `alterar_valor` leva o valor de hoje para ela
// (reajuste pelo IPCA, renegociação). Mudar o valor na tela não muda a
// cobrança sozinho; é este passo que muda, e ele fica na Auditoria.
servir("asaas-assinatura-b2b", async (req: Request) => {
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
    const { organization_id: organizationId, acao = "criar" } = (await req.json()) as {
      organization_id?: string;
      acao?: "criar" | "situacao" | "alterar_valor";
    };
    if (!organizationId || !["criar", "situacao", "alterar_valor"].includes(acao)) return jsonResponse({ error: "Pedido inválido." }, 400);

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
    const arkefit = verificada(claims?.claims) && (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
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

    if (acao === "situacao" || acao === "alterar_valor") {
      if (!arkefit) return jsonResponse({ error: "Só a ArkeFit consulta e muda a assinatura B2B." }, 403);
      if (!org.asaas_subscription_id_b2b) return jsonResponse({ error: "A academia ainda não tem assinatura B2B." }, 409);
      const { data: valorBancoHoje } = await admin.rpc("valor_mensal_b2b", { _organization_id: org.id });
      const valorHoje = valorBancoHoje === null || valorBancoHoje === undefined ? null : Number(valorBancoHoje);
      const sit = await consultarAssinaturaB2b(asaasApiUrl, asaasApiKey, org.asaas_subscription_id_b2b);
      if (!sit.ok) return jsonResponse({ error: sit.erro }, 502);
      if (acao === "situacao") {
        return jsonResponse({
          ok: true,
          valor_asaas: sit.valor,
          status: sit.status,
          proximo_vencimento: sit.proximoVencimento,
          valor_hoje: valorHoje,
          divergente: valorHoje !== null && valorHoje > 0 && Math.abs(sit.valor - valorHoje) > 0.009,
        });
      }
      if (!valorHoje || valorHoje <= 0) {
        return jsonResponse({ error: "O valor de hoje é zero ou não está definido. Para parar a mensalidade, use o encerramento." }, 409);
      }
      if (sit.status !== "ACTIVE") return jsonResponse({ error: `A assinatura não está ativa no Asaas (${sit.status}).` }, 409);
      if (Math.abs(sit.valor - valorHoje) <= 0.009) return jsonResponse({ ok: true, sem_mudanca: true, para: valorHoje });
      const r = await alterarValorAssinaturaB2b(asaasApiUrl, asaasApiKey, org.asaas_subscription_id_b2b, { valor: valorHoje, hoje: hojeBrasilia() });
      if (!r.ok) return jsonResponse({ error: r.erro }, 502);
      const { error: erroAuditoria } = await admin.rpc("registrar_auditoria", {
        _ator_user_id: callerId,
        _acao: "mensalidade_b2b.valor_alterado",
        _entidade: "organizations",
        _entidade_id: org.id,
        _organizacao_nome: org.nome,
        _detalhes: {
          de: sit.valor,
          para: valorHoje,
          pendentes_atualizadas: r.pendentesAtualizadas,
          vencidas_no_valor_antigo: r.vencidasNoValorAntigo.length,
        },
      });
      if (erroAuditoria) console.error("asaas-assinatura-b2b: auditoria", erroAuditoria.code);
      return jsonResponse({
        ok: true,
        de: sit.valor,
        para: valorHoje,
        pendentes_atualizadas: r.pendentesAtualizadas,
        vencidas_no_valor_antigo: r.vencidasNoValorAntigo.length,
      });
    }


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
    // Zero é quem não tem mensalidade própria: a unidade de uma rede (a rede
    // paga na principal) ou um painel que a ArkeFit decidiu não cobrar. Não é
    // erro, e não cria assinatura.
    if (valor === 0) {
      return jsonResponse({ ok: true, sem_cobranca: true, motivo: "Valor zero: sem mensalidade própria." });
    }
    if (!valor || valor < 0) {
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

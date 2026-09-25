import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { garantirClienteB2b } from "../asaas-assinatura-b2b/fluxo.ts";
import { emitirOuAdotarTaxa, validarTaxa } from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Emite a taxa de implantação de uma academia (Visão Master → ficha da
// organização). Só a ArkeFit, com a sessão verificada em duas etapas. Cada
// parcela vira uma linha de `cobrancas_b2b` já na emissão: o webhook só
// registra sozinho as cobranças de assinatura, e é essa linha que a
// conferência diária e a regra de inadimplência B2B enxergam.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);

  try {
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (!callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: papeis } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const arkefit = verificada(claims?.claims) && (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
    if (!arkefit) return jsonResponse({ error: "Só a ArkeFit emite a taxa de implantação." }, 403);

    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgId = String(corpo.organization_id ?? "");
    if (!orgId) return jsonResponse({ error: "Academia não informada." }, 400);
    const validacao = validarTaxa(corpo, hojeBrasilia());
    if (!validacao.ok) return jsonResponse({ error: validacao.erro }, 400);

    const { data: org } = await admin
      .from("organizations")
      .select("id, nome, razao_social, status, cnpj_cpf, email_contato, telefone")
      .eq("id", orgId)
      .maybeSingle();
    if (!org) return jsonResponse({ error: "Academia não encontrada." }, 404);
    const { data: emitida } = await admin.from("taxas_implantacao").select("id").eq("organization_id", orgId).eq("status", "emitida").maybeSingle();
    if (emitida) return jsonResponse({ error: "A taxa de implantação desta academia já foi emitida." }, 409);

    const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
    if ("erro" in ambiente) return jsonResponse({ error: ambiente.erro }, 500);

    const cliente = await garantirClienteB2b(ambiente.api, ambiente.chave, {
      orgId: org.id,
      nome: (org.razao_social as string) || (org.nome as string),
      cpfCnpj: String(org.cnpj_cpf ?? "").replace(/\D/g, ""),
      email: (org.email_contato as string) ?? "",
      telefone: String(org.telefone ?? "").replace(/\D/g, ""),
    });
    if (!cliente.ok) return jsonResponse({ error: cliente.erro }, 422);

    const r = await emitirOuAdotarTaxa(ambiente.api, ambiente.chave, { orgId: org.id, cliente: cliente.id, pedido: validacao.pedido });
    if (!r.ok) return jsonResponse({ error: r.erro }, r.definitivo ? 422 : 502);

    const { error: erroTaxa } = await admin.from("taxas_implantacao").insert({
      organization_id: org.id,
      valor_total: validacao.pedido.valor,
      parcelas: r.parcelas.length || validacao.pedido.parcelas,
      primeiro_vencimento: r.parcelas[0]?.dueDate ?? validacao.pedido.vencimento,
      asaas_installment_id: r.installmentId,
      criada_por: callerId,
    });
    const { error: erroParcelas } = await admin.from("cobrancas_b2b").upsert(
      r.parcelas.map((p) => ({
        organization_id: org.id,
        valor: p.value,
        descricao: p.description ?? "Taxa de implantação ARKE",
        forma_pagamento: "UNDEFINED",
        status: "pendente",
        asaas_customer_id: cliente.id,
        asaas_payment_id: p.id,
        invoice_url: p.invoiceUrl ?? null,
        vencimento: p.dueDate,
        criado_por: callerId,
      })),
      { onConflict: "asaas_payment_id" },
    );
    if (erroTaxa || erroParcelas) {
      // Está emitida no Asaas; emitir de novo adota a mesma (não duplica).
      console.error("taxa de implantação: emitida no Asaas, falhou ao gravar", (erroTaxa ?? erroParcelas)?.code);
      return jsonResponse({ error: "A taxa foi emitida no Asaas, mas não foi registrada aqui. Emita de novo: a mesma cobrança é adotada." }, 500);
    }

    await admin.from("auditoria_acoes_sensiveis").insert({
      ator_user_id: callerId,
      acao: "organizacao.taxa_implantacao",
      entidade: "taxas_implantacao",
      organizacao_nome: org.nome,
      detalhes: { valor: validacao.pedido.valor, parcelas: r.parcelas.length, adotada: r.adotada },
    });
    return jsonResponse({
      adotada: r.adotada,
      parcelas: r.parcelas.map((p) => ({ valor: p.value, vencimento: p.dueDate, fatura: p.invoiceUrl ?? null })),
    });
  } catch (e) {
    console.error("asaas-taxa-implantacao: erro inesperado", e instanceof Error ? e.name : typeof e);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

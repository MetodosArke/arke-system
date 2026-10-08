import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { acessoArkefit } from "../_shared/acessoArkefit.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { garantirClienteB2b } from "../asaas-assinatura-b2b/fluxo.ts";
import { buscarTaxaExistente, emitirOuAdotarTaxa, FalhaIndefinida, linhasDasParcelas, resumoDaTaxa, validarTaxa, type TaxaNoAsaas } from "./fluxo.ts";
import { servir } from "../_shared/servir.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Grava as parcelas em `cobrancas_b2b` sem mexer nas que já estão lá: uma
 * parcela paga continua paga, e a nova tentativa só acrescenta o que faltou.
 */
async function registrarParcelas(admin: SupabaseClient, t: TaxaNoAsaas, orgId: string, cliente: string | null, criadoPor: string) {
  if (!t.parcelas.length) return null;
  const { error } = await admin
    .from("cobrancas_b2b")
    .upsert(linhasDasParcelas(t.parcelas, { orgId, cliente, criadoPor }), { onConflict: "asaas_payment_id", ignoreDuplicates: true });
  return error;
}

// Emite a taxa de implantação de uma academia (Visão Master → ficha da
// organização). Só a ArkeFit, com a sessão verificada em duas etapas. Cada
// parcela vira uma linha de `cobrancas_b2b` já na emissão: o webhook só
// registra sozinho as cobranças de assinatura, e é essa linha que a
// conferência diária e a regra de inadimplência B2B enxergam.
//
// Idempotente (06/10/2026). A emissão começa por uma reserva no banco
// (`reservar_taxa_implantacao`), antes de qualquer chamada ao Asaas: duas
// chamadas ao mesmo tempo não criam dois parcelamentos, porque só uma tem a
// reserva. Com a reserva, procura a taxa no Asaas pela referência antes de
// criar. E a nova tentativa completa o que faltou: se a taxa já está
// emitida, ela só procura no Asaas e grava as parcelas que não entraram em
// `cobrancas_b2b` — nunca emite outra.
servir("asaas-taxa-implantacao", async (req: Request) => {
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
    // Os níveis da equipe ArkeFit (08/10/2026): a taxa de implantação é da
    // área `financeiro` (o Financeiro e o Sócio), perguntada ao banco com a
    // sessão de quem chama (`acesso_arkefit`), que exige as duas etapas.
    const arkefit = verificada(claims?.claims) ? await acessoArkefit(asUser, claims?.claims, "financeiro") : false;
    if (arkefit === null) return jsonResponse({ error: "Não foi possível conferir o acesso agora. Tente de novo." }, 500);
    if (!arkefit) return jsonResponse({ error: "Só a equipe da ArkeFit com acesso ao financeiro emite a taxa de implantação." }, 403);

    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orgId = String(corpo.organization_id ?? "");
    if (!orgId) return jsonResponse({ error: "Academia não informada." }, 400);
    // `completar`: a tela pede só o registro das parcelas que faltaram, sem pedido novo.
    const completar = corpo.completar === true;
    const validacao = completar ? null : validarTaxa(corpo, hojeBrasilia());
    if (validacao && !validacao.ok) return jsonResponse({ error: validacao.erro }, 400);
    const pedido = validacao?.ok ? validacao.pedido : null;

    const { data: org, error: erroOrg } = await admin
      .from("organizations")
      .select("id, nome, razao_social, status, cnpj_cpf, email_contato, telefone")
      .eq("id", orgId)
      .maybeSingle();
    if (erroOrg) return jsonResponse({ error: "Não foi possível consultar a academia agora." }, 500);
    if (!org) return jsonResponse({ error: "Academia não encontrada." }, 404);

    const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
    if ("erro" in ambiente) return jsonResponse({ error: ambiente.erro }, 500);

    // ── Taxa já emitida: completa o registro, nunca emite outra ─────────
    const completarRegistro = async () => {
      let noAsaas: TaxaNoAsaas | null;
      try {
        noAsaas = await buscarTaxaExistente(ambiente.api, ambiente.chave, org.id);
      } catch (e) {
        if (e instanceof FalhaIndefinida) return jsonResponse({ error: "Não foi possível falar com o Asaas agora. Tente de novo em instantes." }, 502);
        throw e;
      }
      if (!noAsaas) {
        return jsonResponse({ error: "A taxa desta academia consta como emitida, mas não foi encontrada no Asaas. Confira no painel do Asaas antes de emitir outra." }, 409);
      }
      const { data: jaRegistradas, error: erroLeitura } = await admin
        .from("cobrancas_b2b")
        .select("asaas_payment_id")
        .in("asaas_payment_id", noAsaas.parcelas.map((p) => p.id));
      if (erroLeitura) return jsonResponse({ error: "Não foi possível conferir as parcelas agora." }, 500);
      const faltavam = noAsaas.parcelas.length - (jaRegistradas ?? []).length;
      if (faltavam <= 0) return jsonResponse({ error: "A taxa de implantação desta academia já foi emitida." }, 409);
      const erroParcelas = await registrarParcelas(admin, noAsaas, org.id, noAsaas.parcelas[0]?.customer ?? null, callerId);
      if (erroParcelas) {
        console.error("taxa de implantação: falhou ao completar as parcelas", erroParcelas.code);
        return jsonResponse({ error: "Não foi possível registrar as parcelas agora. Tente de novo." }, 500);
      }
      await admin.from("auditoria_acoes_sensiveis").insert({
        ator_user_id: callerId,
        acao: "organizacao.taxa_implantacao_completada",
        entidade: "taxas_implantacao",
        organizacao_nome: org.nome,
        detalhes: { parcelas_registradas: faltavam },
      });
      return jsonResponse({
        adotada: true,
        completada: faltavam,
        parcelas: noAsaas.parcelas.map((p) => ({ valor: p.value, vencimento: p.dueDate, fatura: p.invoiceUrl ?? null })),
      });
    };

    if (completar || !pedido) {
      const { data: emitida, error: erroEmitida } = await admin
        .from("taxas_implantacao")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "emitida")
        .maybeSingle();
      if (erroEmitida) return jsonResponse({ error: "Não foi possível consultar a taxa agora." }, 500);
      if (!emitida) return jsonResponse({ error: "Não há taxa emitida para completar." }, 409);
      return await completarRegistro();
    }

    // ── Reserva antes do Asaas ──────────────────────────────────────────
    const { data: reservas, error: erroReserva } = await admin.rpc("reservar_taxa_implantacao", {
      _organization_id: org.id,
      _valor_total: pedido.valor,
      _parcelas: pedido.parcelas,
      _primeiro_vencimento: pedido.vencimento,
      _criada_por: callerId,
    });
    if (erroReserva) {
      console.error("taxa de implantação: reserva recusada", erroReserva.code);
      return jsonResponse({ error: "Não foi possível começar a emissão agora. Tente de novo." }, 500);
    }
    const reserva = (reservas as { taxa_id: string; situacao: string }[] | null)?.[0];
    if (!reserva) return jsonResponse({ error: "Não foi possível começar a emissão agora. Tente de novo." }, 500);
    if (reserva.situacao === "emitida") return await completarRegistro();
    if (reserva.situacao !== "reservada") {
      return jsonResponse({ error: "A taxa desta academia está sendo emitida agora. Aguarde um instante e confira." }, 409);
    }

    // Daqui até o fim a reserva é desta chamada. Saída sem concluir encurta a
    // reserva, para a próxima tentativa assumir na hora (e procurar no Asaas
    // antes de criar); a recusa definitiva do Asaas, em que nada foi criado,
    // a apaga.
    let concluida = false;
    let liberar: "encurtar" | "apagar" = "encurtar";
    try {
      const cliente = await garantirClienteB2b(ambiente.api, ambiente.chave, {
        orgId: org.id,
        nome: (org.razao_social as string) || (org.nome as string),
        cpfCnpj: String(org.cnpj_cpf ?? "").replace(/\D/g, ""),
        email: (org.email_contato as string) ?? "",
        telefone: String(org.telefone ?? "").replace(/\D/g, ""),
      });
      if (!cliente.ok) {
        liberar = "apagar";
        return jsonResponse({ error: cliente.erro }, 422);
      }

      const r = await emitirOuAdotarTaxa(ambiente.api, ambiente.chave, { orgId: org.id, cliente: cliente.id, pedido });
      if (!r.ok) {
        if (r.definitivo) liberar = "apagar";
        return jsonResponse({ error: r.erro }, r.definitivo ? 422 : 502);
      }

      // As parcelas primeiro: é o que entra no bloqueio B2B. Se a taxa não
      // passar a `emitida` depois, a próxima tentativa assume a reserva,
      // adota a mesma cobrança e termina.
      const erroParcelas = await registrarParcelas(admin, r, org.id, cliente.id, callerId);
      const { error: erroTaxa } = erroParcelas
        ? { error: null }
        : await admin
            .from("taxas_implantacao")
            .update({ ...resumoDaTaxa(r, pedido), status: "emitida", reservada_ate: null })
            .eq("id", reserva.taxa_id)
            .eq("status", "emitindo");
      if (erroParcelas || erroTaxa) {
        console.error("taxa de implantação: emitida no Asaas, falhou ao gravar", (erroParcelas ?? erroTaxa)?.code);
        return jsonResponse({ error: "A taxa foi emitida no Asaas, mas não foi registrada aqui. Emita de novo: a mesma cobrança é adotada e o registro se completa." }, 500);
      }
      concluida = true;

      await admin.from("auditoria_acoes_sensiveis").insert({
        ator_user_id: callerId,
        acao: "organizacao.taxa_implantacao",
        entidade: "taxas_implantacao",
        organizacao_nome: org.nome,
        detalhes: { valor: resumoDaTaxa(r, pedido).valor_total, parcelas: r.parcelas.length, adotada: r.adotada },
      });
      return jsonResponse({
        adotada: r.adotada,
        parcelas: r.parcelas.map((p) => ({ valor: p.value, vencimento: p.dueDate, fatura: p.invoiceUrl ?? null })),
      });
    } finally {
      if (!concluida) {
        const { error } = liberar === "apagar"
          ? await admin.from("taxas_implantacao").delete().eq("id", reserva.taxa_id).eq("status", "emitindo")
          : await admin.from("taxas_implantacao").update({ reservada_ate: new Date().toISOString() }).eq("id", reserva.taxa_id).eq("status", "emitindo");
        // A reserva que não sai vence sozinha em minutos.
        if (error) console.error("taxa de implantação: reserva não liberada", error.code);
      }
    }
  } catch (e) {
    console.error("asaas-taxa-implantacao: erro inesperado", e instanceof Error ? e.name : typeof e);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

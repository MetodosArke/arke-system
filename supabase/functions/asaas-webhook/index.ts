import { createClient } from "npm:@supabase/supabase-js@2";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Eventos de pagamento do Asaas que efetivamente mudam o status da assinatura/pagamento.
// https://docs.asaas.com/docs/webhook-events
const EVENTOS_CONFIRMADOS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
const EVENTOS_ATRASADOS = new Set(["PAYMENT_OVERDUE"]);
const EVENTOS_ESTORNADOS = new Set(["PAYMENT_REFUNDED", "PAYMENT_DELETED", "PAYMENT_CHARGEBACK_REQUESTED"]);

// Webhook do Asaas: recebe eventos de pagamento, registra em log de auditoria
// (idempotente por asaas_event_id/asaas_payment_id) e atualiza pagamentos e
// o status da assinatura do aluno. Não usa o JWT do Supabase — a autenticação
// é feita pelo token compartilhado configurado no próprio Asaas
// (header "asaas-access-token"), comparado ao secret ASAAS_WEBHOOK_SECRET.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("ASAAS_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  if (!webhookSecret) {
    console.error("ASAAS_WEBHOOK_SECRET não configurada");
    return jsonResponse({ error: "Webhook não configurado." }, 500);
  }

  const tokenRecebido = req.headers.get("asaas-access-token");
  if (tokenRecebido !== webhookSecret) {
    return jsonResponse({ error: "Assinatura do webhook inválida." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Payload inválido." }, 400);
  }

  const tipoEvento = String(payload.event ?? "");
  const payment = (payload.payment ?? {}) as Record<string, unknown>;
  const asaasPaymentId = payment.id ? String(payment.id) : null;
  const invoiceUrl = payment.invoiceUrl ? String(payment.invoiceUrl) : null;
  // Asaas não garante um id de evento estável em todos os planos; usamos
  // event+payment.id como chave de idempotência quando não houver um id próprio.
  const asaasEventId = payload.id ? String(payload.id) : `${tipoEvento}:${asaasPaymentId ?? "sem-payment"}`;

  // 1) Log de auditoria primeiro (sempre grava, mesmo que o processamento falhe depois)
  const { data: eventoExistente } = await admin
    .from("asaas_webhook_events")
    .select("id, processado")
    .eq("asaas_event_id", asaasEventId)
    .maybeSingle();

  if (eventoExistente?.processado) {
    // Idempotência: evento já processado, responde 200 sem repetir efeitos colaterais.
    return jsonResponse({ ok: true, idempotente: true });
  }

  const { data: eventoRegistrado, error: logError } = await admin
    .from("asaas_webhook_events")
    .upsert(
      {
        asaas_event_id: asaasEventId,
        asaas_payment_id: asaasPaymentId,
        tipo_evento: tipoEvento,
        payload,
      },
      { onConflict: "asaas_event_id" }
    )
    .select("id")
    .single();

  if (logError || !eventoRegistrado) {
    console.error("Falha ao registrar evento de webhook", logError);
    return jsonResponse({ error: "Falha ao registrar evento." }, 500);
  }

  try {
    if (asaasPaymentId) {
      const { data: pagamentoExistente } = await admin
        .from("pagamentos")
        .select("id, aluno_assinatura_id")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

      let novoStatus: "confirmado" | "atrasado" | "estornado" | null = null;
      if (EVENTOS_CONFIRMADOS.has(tipoEvento)) novoStatus = "confirmado";
      else if (EVENTOS_ATRASADOS.has(tipoEvento)) novoStatus = "atrasado";
      else if (EVENTOS_ESTORNADOS.has(tipoEvento)) novoStatus = "estornado";

      if (pagamentoExistente && novoStatus) {
        await admin
          .from("pagamentos")
          .update({
            status: novoStatus,
            data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
            invoice_url: invoiceUrl ?? undefined,
          })
          .eq("id", pagamentoExistente.id);

        if (novoStatus === "atrasado" || novoStatus === "estornado") {
          // Guarda o link da fatura para o App do Aluno redirecionar à
          // quitação (gate de inadimplência em /app).
          await admin
            .from("aluno_assinaturas")
            .update({ status: "atrasada", fatura_pendente_url: invoiceUrl })
            .eq("id", pagamentoExistente.aluno_assinatura_id);
        } else if (novoStatus === "confirmado") {
          // Pagamento confirmado: libera o acesso imediatamente, limpando
          // a fatura pendente.
          await admin
            .from("aluno_assinaturas")
            .update({ status: "ativa", fatura_pendente_url: null })
            .eq("id", pagamentoExistente.aluno_assinatura_id);
        }
      } else if (!pagamentoExistente && novoStatus) {
        // Primeira notificação desse pagamento: cria o registro a partir da
        // assinatura já existente (criada por asaas-create-subscription).
        const subscriptionId = payment.subscription ? String(payment.subscription) : null;
        if (subscriptionId) {
          const { data: assinatura } = await admin
            .from("aluno_assinaturas")
            .select("id, organization_id, valor_cobrado, nivel_atacado")
            .eq("asaas_subscription_id", subscriptionId)
            .maybeSingle();

          if (assinatura) {
            const { data: plano } = await admin
              .from("planos_atacado")
              .select("custo_mensal")
              .eq("id", assinatura.nivel_atacado)
              .single();

            const valor = Number(payment.value ?? assinatura.valor_cobrado);
            const valorRepasseArke = Number(plano?.custo_mensal ?? 0);

            await admin.from("pagamentos").insert({
              organization_id: assinatura.organization_id,
              aluno_assinatura_id: assinatura.id,
              valor,
              valor_repasse_arke: valorRepasseArke,
              valor_liquido_academia: valor - valorRepasseArke,
              status: novoStatus,
              asaas_payment_id: asaasPaymentId,
              data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
              invoice_url: invoiceUrl,
            });

            if (novoStatus === "atrasado" || novoStatus === "estornado") {
              await admin
                .from("aluno_assinaturas")
                .update({ status: "atrasada", fatura_pendente_url: invoiceUrl })
                .eq("id", assinatura.id);
            } else if (novoStatus === "confirmado") {
              await admin
                .from("aluno_assinaturas")
                .update({ status: "ativa", fatura_pendente_url: null })
                .eq("id", assinatura.id);
            }
          }
        }
      }
    }

    await admin
      .from("asaas_webhook_events")
      .update({ processado: true, processed_at: new Date().toISOString() })
      .eq("id", eventoRegistrado.id);

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Erro ao processar webhook do Asaas", error);
    await admin
      .from("asaas_webhook_events")
      .update({ erro: String(error) })
      .eq("id", eventoRegistrado.id);
    // Responde 200 para o Asaas não ficar reentregando indefinidamente um
    // evento cujo log já foi gravado; o erro fica registrado para investigação.
    return jsonResponse({ ok: false, erro_interno: true });
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Comparação em tempo constante — evita que diferenças no tempo de resposta
// de uma comparação de string comum (que sai no primeiro byte diferente)
// vazem informação sobre o ASAAS_WEBHOOK_SECRET byte a byte.
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let resultado = 0;
  for (let i = 0; i < bufA.length; i++) {
    resultado |= bufA[i] ^ bufB[i];
  }
  return resultado === 0;
}

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
  if (!tokenRecebido || !timingSafeEqual(tokenRecebido, webhookSecret)) {
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
      let novoStatus: "confirmado" | "atrasado" | "estornado" | null = null;
      if (EVENTOS_CONFIRMADOS.has(tipoEvento)) novoStatus = "confirmado";
      else if (EVENTOS_ATRASADOS.has(tipoEvento)) novoStatus = "atrasado";
      else if (EVENTOS_ESTORNADOS.has(tipoEvento)) novoStatus = "estornado";

      // Cobrança B2B (ARKE cobrando a própria academia/studio, emitida via
      // asaas-emitir-cobranca-b2b) — id de pagamento nunca colide com o do
      // fluxo B2C abaixo, então checar aqui primeiro e, se achar, não passa
      // pelo restante do bloco (aluno_assinaturas não tem nada a ver com isso).
      const { data: cobrancaB2bExistente } = await admin
        .from("cobrancas_b2b")
        .select("id")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

      if (cobrancaB2bExistente) {
        if (novoStatus) {
          await admin
            .from("cobrancas_b2b")
            .update({ status: novoStatus, invoice_url: invoiceUrl ?? undefined })
            .eq("id", cobrancaB2bExistente.id);
        }
        await admin
          .from("asaas_webhook_events")
          .update({ processado: true, processed_at: new Date().toISOString() })
          .eq("id", eventoRegistrado.id);
        return jsonResponse({ ok: true });
      }

      // Mensalidade da academia (plano próprio dela, ver
      // academia-criar-matricula) — outro fluxo que não tem nada a ver com
      // aluno_assinaturas/pagamentos (Método ARKE), checa aqui antes de
      // cair no bloco de adesão ao método.
      const { data: mensalidadeExistente } = await admin
        .from("mensalidades")
        .select("id, matricula_id")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

      if (mensalidadeExistente) {
        if (novoStatus) {
          await admin
            .from("mensalidades")
            .update({
              status: novoStatus,
              data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
              invoice_url: invoiceUrl ?? undefined,
            })
            .eq("id", mensalidadeExistente.id);

          if (novoStatus === "atrasado") {
            await admin.rpc("abrir_tarefa_mensalidade_atrasada", { _mensalidade_id: mensalidadeExistente.id });
          }
        }
        await admin
          .from("asaas_webhook_events")
          .update({ processado: true, processed_at: new Date().toISOString() })
          .eq("id", eventoRegistrado.id);
        return jsonResponse({ ok: true });
      }

      const { data: pagamentoExistente } = await admin
        .from("pagamentos")
        .select("id, aluno_assinatura_id")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

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
        // assinatura já existente (Método ARKE via asaas-create-subscription
        // ou mensalidade da academia via academia-criar-matricula).
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

            // upsert (não insert): duas entregas duplicadas do webhook podem
            // passar pelo check de "processado" quase ao mesmo tempo (janela
            // entre a leitura e a gravação da flag). Com insert puro, a
            // segunda bateria na constraint única de asaas_payment_id e
            // cairia no catch como erro; com upsert ela só sobrescreve com
            // o mesmo resultado, mantendo a idempotência de fato.
            await admin.from("pagamentos").upsert(
              {
                organization_id: assinatura.organization_id,
                aluno_assinatura_id: assinatura.id,
                valor,
                valor_repasse_arke: valorRepasseArke,
                valor_liquido_academia: valor - valorRepasseArke,
                status: novoStatus,
                asaas_payment_id: asaasPaymentId,
                data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
                invoice_url: invoiceUrl,
              },
              { onConflict: "asaas_payment_id" }
            );

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
          } else {
            // Não é assinatura do Método ARKE — tenta como matrícula de
            // plano próprio da academia.
            const { data: matricula } = await admin
              .from("aluno_matriculas_academia")
              .select("id, organization_id, aluno_id, valor_repasse_arke, valor_liquido_academia")
              .eq("asaas_subscription_id", subscriptionId)
              .maybeSingle();

            if (matricula) {
              const valor = Number(payment.value ?? 0);
              const vencimento = payment.dueDate ? String(payment.dueDate) : new Date().toISOString().slice(0, 10);
              const competencia = `${vencimento.slice(0, 7)}-01`;

              // upsert por (matricula_id, competencia): mesma janela de
              // idempotência descrita acima, mas usando a chave natural da
              // mensalidade em vez do asaas_payment_id (que só é
              // preenchido aqui, pela primeira vez). O repasse/líquido vem
              // do snapshot gravado na matrícula (é o que o split do Asaas
              // já define desde a criação da assinatura, não recalcula a
              // cada evento).
              const { data: mensalidadeCriada } = await admin
                .from("mensalidades")
                .upsert(
                  {
                    organization_id: matricula.organization_id,
                    matricula_id: matricula.id,
                    aluno_id: matricula.aluno_id,
                    competencia,
                    valor,
                    valor_repasse_arke: matricula.valor_repasse_arke,
                    valor_liquido_academia: matricula.valor_liquido_academia,
                    vencimento,
                    status: novoStatus,
                    asaas_payment_id: asaasPaymentId,
                    data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
                    invoice_url: invoiceUrl,
                  },
                  { onConflict: "matricula_id,competencia" }
                )
                .select("id")
                .single();

              if (novoStatus === "atrasado" && mensalidadeCriada) {
                await admin.rpc("abrir_tarefa_mensalidade_atrasada", { _mensalidade_id: mensalidadeCriada.id });
              }
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

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

// Eventos que apenas **emitem** a cobrança, sem mudar o status de quem já
// pagou ou deixou de pagar. Não entram em EVENTOS_* acima de propósito: nada
// neles muda a situação da assinatura.
//
// Eles eram ignorados por completo, e isso abria o buraco que a rede de
// segurança B2C precisa fechar. Como a linha em `pagamentos` só nascia no
// primeiro evento que mudava status, um PAYMENT_OVERDUE perdido deixava a
// cobrança sem linha nenhuma — e uma verificação de "venceu e ninguém
// confirmou" não tem o que verificar se a cobrança não existe no banco.
// Registrando a emissão como `pendente` com o vencimento do Asaas, toda
// cobrança esperada passa a ter registro, e o vencimento vencido fala por si.
const EVENTOS_EMITIDOS = new Set(["PAYMENT_CREATED", "PAYMENT_UPDATED"]);

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
  // Segredo próprio da homologação. O Asaas não devolve o token configurado
  // (só `hasAuthToken`), então o sandbox não tem como reusar o de produção —
  // e não deveria: é credencial de teste, mais exposta por natureza.
  const webhookSecretSandbox = Deno.env.get("ASAAS_SANDBOX_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  if (!webhookSecret) {
    console.error("ASAAS_WEBHOOK_SECRET não configurada");
    return jsonResponse({ error: "Webhook não configurado." }, 500);
  }

  const tokenRecebido = req.headers.get("asaas-access-token");
  // Qual dos dois segredos validou decide o que este evento pode tocar.
  const origemEvento: "producao" | "sandbox" | null = !tokenRecebido
    ? null
    : timingSafeEqual(tokenRecebido, webhookSecret)
      ? "producao"
      : webhookSecretSandbox && timingSafeEqual(tokenRecebido, webhookSecretSandbox)
        ? "sandbox"
        : null;
  if (!origemEvento) {
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
  // Base da rede de segurança contra webhook perdido: sem a data de
  // vencimento não há como perguntar "esta cobrança venceu e ninguém
  // confirmou".
  const vencimento = payment.dueDate ? String(payment.dueDate) : null;
  // Taxa que o Asaas descontou: sai da parte da ArkeFit (a academia recebe o
  // split em valor fixo), e é o que separa receita bruta de líquida. Na
  // emissão o netValue é estimado; na confirmação, definitivo — cada evento
  // regrava. Sem os dois números, fica de fora em vez de virar zero.
  const valorBruto = payment.value;
  const valorLiquido = payment.netValue;
  const taxaGateway =
    typeof valorBruto === "number" && typeof valorLiquido === "number" && valorLiquido > 0
      ? Math.max(0, Math.round((valorBruto - valorLiquido) * 100) / 100)
      : undefined;
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

  // Desfecho do evento, gravado junto com `processado`. Sem isto,
  // "processado" só quer dizer "a função terminou sem exceção": um evento
  // cujo payment_id não casa com nenhuma cobrança do banco percorre todos
  // os ramos, não atualiza nada e fica marcado igual a um que funcionou.
  // O painel de webhooks da Visão Master lê esta coluna para separar os dois.
  const concluir = async (resultado: string) => {
    await admin
      .from("asaas_webhook_events")
      .update({ processado: true, processed_at: new Date().toISOString(), resultado })
      .eq("id", eventoRegistrado.id);
  };

  // Trava de ambiente: evento do sandbox só toca organização em homologação,
  // evento de produção só toca organização real.
  //
  // Não é defesa contra colisão de id (o espaço do Asaas torna isso irreal) —
  // é contenção de raio. O segredo do sandbox é credencial de teste e vive
  // mais exposta; sem esta trava, quem o obtivesse poderia forjar um
  // PAYMENT_CONFIRMED para a assinatura de um aluno pagante de verdade e lhe
  // dar acesso de graça. Com ela, o estrago para em organizações em trial.
  const referencia = payment.externalReference ? String(payment.externalReference) : null;
  const subscriptionDoEvento = payment.subscription ? String(payment.subscription) : null;
  const statusDaOrganizacao = async (): Promise<string | null> => {
    if (subscriptionDoEvento) {
      const [metodo, b2b, mensalidade] = await Promise.all([
        admin.from("aluno_assinaturas").select("organization_id").eq("asaas_subscription_id", subscriptionDoEvento).maybeSingle(),
        admin.from("organizations").select("status").eq("asaas_subscription_id_b2b", subscriptionDoEvento).maybeSingle(),
        admin.from("aluno_matriculas_academia").select("organization_id").eq("asaas_subscription_id", subscriptionDoEvento).limit(1).maybeSingle(),
      ]);
      if (b2b.data?.status) return b2b.data.status;
      const orgId = metodo.data?.organization_id ?? mensalidade.data?.organization_id;
      if (orgId) {
        const { data } = await admin.from("organizations").select("status").eq("id", orgId).maybeSingle();
        return data?.status ?? null;
      }
    }
    // `org:<id>` e `b2b:<id>` carregam a organização direto na referência.
    const m = referencia?.match(/^(?:org|b2b):([0-9a-f-]{36})$/i);
    if (m) {
      const { data } = await admin.from("organizations").select("status").eq("id", m[1]).maybeSingle();
      return data?.status ?? null;
    }
    return null;
  };
  const statusOrg = await statusDaOrganizacao();
  // Evento que não resolve organização nenhuma não tem o que tocar; segue e
  // termina como "sem correspondência", que é o desfecho honesto.
  if (statusOrg !== null) {
    const ehHomologacao = statusOrg === "trial";
    if (ehHomologacao !== (origemEvento === "sandbox")) {
      await concluir(`ambiente_incompativel:${origemEvento}`);
      return jsonResponse({ ok: true, ignorado: "ambiente incompatível" });
    }
  }

  try {
    // Sem payment.id não há o que casar; o evento fica registrado só como log.
    let resultado = "sem_payment_id";

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
            .update({
              status: novoStatus,
              invoice_url: invoiceUrl ?? undefined,
              taxa_gateway: taxaGateway,
              // Sem a data de liquidação, a série histórica de receita
              // teria que cair no mês de emissão da cobrança, não no mês
              // em que o dinheiro entrou.
              data_pagamento: novoStatus === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
            })
            .eq("id", cobrancaB2bExistente.id);
        } else if (EVENTOS_EMITIDOS.has(tipoEvento)) {
          // Emissão fora de ordem (chegou depois do status): atualiza
          // vencimento e fatura, nunca o status — mesma regra do `soEmissao`
          // do Método ARKE, pelo mesmo motivo.
          await admin
            .from("cobrancas_b2b")
            .update({ vencimento: vencimento ?? undefined, invoice_url: invoiceUrl ?? undefined })
            .eq("id", cobrancaB2bExistente.id);
        }
        await concluir(novoStatus ? "cobranca_b2b_atualizada" : EVENTOS_EMITIDOS.has(tipoEvento) ? "cobranca_b2b_emitida" : "evento_ignorado");
        return jsonResponse({ ok: true });
      }

      // Mensalidade B2B recorrente (asaas-assinatura-b2b): as cobranças nascem
      // no Asaas, não aqui, então a primeira notícia de cada uma é o webhook.
      // A emissão vira linha `pendente` com o vencimento do Asaas — é o que
      // permite a organizacao_inadimplente_b2b() enxergar a cobrança vencida
      // mesmo que o PAYMENT_OVERDUE se perca.
      const subscriptionB2b = payment.subscription ? String(payment.subscription) : null;
      if (subscriptionB2b) {
        const { data: orgB2b } = await admin
          .from("organizations")
          .select("id")
          .eq("asaas_subscription_id_b2b", subscriptionB2b)
          .maybeSingle();
        if (orgB2b) {
          const statusB2b = novoStatus ?? (EVENTOS_EMITIDOS.has(tipoEvento) ? "pendente" : null);
          if (statusB2b) {
            const tipo = String(payment.billingType ?? "UNDEFINED");
            await admin.from("cobrancas_b2b").upsert(
              {
                organization_id: orgB2b.id,
                valor: Number(payment.value ?? 0),
                descricao: payment.description ? String(payment.description) : "Mensalidade ARKE",
                forma_pagamento: ["PIX", "CREDIT_CARD", "BOLETO"].includes(tipo) ? tipo : "UNDEFINED",
                status: statusB2b,
                asaas_customer_id: payment.customer ? String(payment.customer) : null,
                asaas_payment_id: asaasPaymentId,
                invoice_url: invoiceUrl,
                vencimento: vencimento ?? undefined,
                taxa_gateway: taxaGateway,
                data_pagamento: statusB2b === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
              },
              { onConflict: "asaas_payment_id" }
            );
          }
          await concluir(statusB2b === "pendente" ? "cobranca_b2b_emitida" : statusB2b ? "cobranca_b2b_criada" : "evento_ignorado");
          return jsonResponse({ ok: true });
        }
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
              taxa_gateway: taxaGateway,
            })
            .eq("id", mensalidadeExistente.id);

          if (novoStatus === "atrasado") {
            await admin.rpc("abrir_tarefa_mensalidade_atrasada", { _mensalidade_id: mensalidadeExistente.id });
          }
        }
        await concluir(novoStatus ? "mensalidade_atualizada" : "evento_ignorado");
        return jsonResponse({ ok: true });
      }

      // Daqui para baixo é o Método ARKE (aluno_assinaturas/pagamentos), e só
      // aqui a emissão importa: `statusArke` cobre um evento a mais que
      // `novoStatus`. Os blocos B2B e de mensalidade acima não registram a
      // emissão — cada um tem o próprio ciclo; em comum com este, só gravam
      // a taxa do gateway.
      const statusArke: "confirmado" | "atrasado" | "estornado" | "pendente" | null =
        novoStatus ?? (EVENTOS_EMITIDOS.has(tipoEvento) ? "pendente" : null);

      const { data: pagamentoExistente } = await admin
        .from("pagamentos")
        .select("id, aluno_assinatura_id")
        .eq("asaas_payment_id", asaasPaymentId)
        .maybeSingle();

      // Recusa na cobrança recorrente do cartão. Não muda o status da
      // cobrança nem corta o acesso — ela ainda não venceu, e quem corta por
      // vencimento é aluno_inadimplente_b2c. O que muda é que a academia
      // precisa agir agora: o aluno quer continuar e o cartão falhou (venceu,
      // estourou o limite, foi trocado). Vira tarefa na fila, e o link da
      // fatura fica guardado para o aluno pagar pela página enquanto isso.
      if (tipoEvento === "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED") {
        let assinaturaId: string | null = pagamentoExistente?.aluno_assinatura_id ?? null;
        const subscriptionId = payment.subscription ? String(payment.subscription) : null;
        if (!assinaturaId && subscriptionId) {
          const { data: porAssinatura } = await admin
            .from("aluno_assinaturas")
            .select("id")
            .eq("asaas_subscription_id", subscriptionId)
            .maybeSingle();
          assinaturaId = porAssinatura?.id ?? null;
        }
        if (assinaturaId) {
          await admin
            .from("aluno_assinaturas")
            .update({
              cartao_recusado_em: new Date().toISOString(),
              ...(invoiceUrl ? { fatura_pendente_url: invoiceUrl } : {}),
            })
            .eq("id", assinaturaId);
          await admin.rpc("abrir_tarefa_cartao_recusado", {
            _aluno_assinatura_id: assinaturaId,
            _asaas_payment_id: asaasPaymentId,
          });
        }
        await concluir(assinaturaId ? "cartao_recusado" : "sem_correspondencia");
        return jsonResponse({ ok: true });
      }

      if (pagamentoExistente && statusArke) {
        // Um PAYMENT_UPDATED pode chegar depois da confirmação (e o Asaas não
        // garante ordem de entrega). Deixar a emissão sobrescrever o status
        // devolveria a cobrança para `pendente` e, com o vencimento no
        // passado, bloquearia um aluno que já pagou — o defeito oposto ao que
        // este trabalho conserta, e pior, porque atinge quem está em dia.
        const soEmissao = statusArke === "pendente";
        await admin
          .from("pagamentos")
          .update({
            ...(soEmissao ? {} : {
              status: statusArke,
              data_pagamento: statusArke === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
            }),
            vencimento: vencimento ?? undefined,
            invoice_url: invoiceUrl ?? undefined,
            taxa_gateway: taxaGateway,
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
            .update({ status: "ativa", fatura_pendente_url: null, cartao_recusado_em: null })
            .eq("id", pagamentoExistente.aluno_assinatura_id);
        }
        resultado = statusArke === "pendente" ? "pagamento_arke_emitido" : "pagamento_arke_atualizado";
      } else if (!pagamentoExistente && statusArke) {
        // Primeira notificação desse pagamento: cria o registro a partir da
        // assinatura já existente (Método ARKE via asaas-create-subscription
        // ou mensalidade da academia via academia-criar-matricula).
        const subscriptionId = payment.subscription ? String(payment.subscription) : null;
        if (subscriptionId) {
          const { data: assinatura } = await admin
            .from("aluno_assinaturas")
            .select("id, organization_id, valor_cobrado, nivel_atacado, valor_repasse_arke")
            .eq("asaas_subscription_id", subscriptionId)
            .maybeSingle();

          if (assinatura) {
            const valor = Number(payment.value ?? assinatura.valor_cobrado);
            // O repasse travado na criação é o que o split do Asaas pratica.
            // Assinatura anterior a esse registro cai no custo de atacado.
            let valorRepasseArke = assinatura.valor_repasse_arke === null ? null : Number(assinatura.valor_repasse_arke);
            if (valorRepasseArke === null) {
              const { data: plano } = await admin
                .from("planos_atacado")
                .select("custo_mensal")
                .eq("id", assinatura.nivel_atacado)
                .single();
              valorRepasseArke = Number(plano?.custo_mensal ?? 0);
            }

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
                valor_liquido_academia: Math.round((valor - valorRepasseArke) * 100) / 100,
                taxa_gateway: taxaGateway,
                status: statusArke,
                asaas_payment_id: asaasPaymentId,
                vencimento,
                data_pagamento: statusArke === "confirmado" ? new Date().toISOString().slice(0, 10) : null,
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
                .update({ status: "ativa", fatura_pendente_url: null, cartao_recusado_em: null })
                .eq("id", assinatura.id);
            }
            resultado = statusArke === "pendente" ? "pagamento_arke_emitido" : "pagamento_arke_criado";
          } else {
            // Não é assinatura do Método ARKE — tenta como matrícula de
            // plano próprio da academia.
            const { data: matricula } = await admin
              .from("aluno_matriculas_academia")
              .select("id, organization_id, aluno_id, valor_repasse_arke, valor_liquido_academia")
              .eq("asaas_subscription_id", subscriptionId)
              .maybeSingle();

            if (matricula && !novoStatus) {
              // Emissão (PAYMENT_CREATED/UPDATED) de mensalidade de plano
              // próprio da academia. Este fluxo ficou de fora da mudança de
              // propósito — e precisa ficar: `mensalidades.status` é NOT NULL,
              // então criar a linha aqui com `novoStatus` nulo quebraria o
              // upsert. Se a rede de segurança for estendida ao plano próprio
              // um dia, é aqui e com status explícito.
              resultado = "evento_ignorado";
            } else if (matricula) {
              const valor = Number(payment.value ?? 0);
              const vencimentoMensalidade = vencimento ?? new Date().toISOString().slice(0, 10);
              const competencia = `${vencimentoMensalidade.slice(0, 7)}-01`;

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
                    taxa_gateway: taxaGateway,
                    vencimento: vencimentoMensalidade,
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
              resultado = "mensalidade_criada";
            } else {
              // Nem assinatura do Método ARKE nem matrícula de plano da
              // academia. Sintoma clássico de wallet/subscription apontando
              // para outro ambiente do Asaas — o evento chega, é aceito e
              // não muda nada.
              resultado = "sem_correspondencia";
            }
          }
        } else {
          // Cobrança avulsa, sem assinatura por trás: nada para vincular.
          resultado = "sem_correspondencia";
        }
      } else {
        // Tipo de evento que não muda status nem emite cobrança (PAYMENT_
        // ANTICIPATED, PAYMENT_RESTORED...): registrado no log, sem efeito por
        // definição. PAYMENT_CREATED/PAYMENT_UPDATED saíram desta lista — hoje
        // registram a cobrança emitida no fluxo do Método ARKE.
        resultado = "evento_ignorado";
      }
    }

    await concluir(resultado);

    return jsonResponse({ ok: true, resultado });
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

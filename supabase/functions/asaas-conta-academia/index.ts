import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { acessoArkefit } from "../_shared/acessoArkefit.ts";
import {
  aceiteDosTermos,
  avisoDeTrocaDeCarteira,
  carteirasProprias,
  consultarSituacao,
  criarOuAdotarSubconta,
  ehTrocaDeCarteira,
  montarSubconta,
  SUBCONTA_DESLIGADA,
  documentosDaSubconta,
  subcontaDisponivel,
  TERMOS_ASAAS_URL,
  walletIdValido,
} from "./fluxo.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { dentroDoFreio, MENSAGEM_FREIO, regrasAsaas } from "../_shared/freio.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { MENSAGEM_PERFIL_SIMULADO, sessaoSimulada } from "../_shared/sessaoSimulada.ts";
import { contaDaCobranca } from "../_shared/contaDaAcademia.ts";
import {
  gerarTokenWebhook,
  hashDoTokenWebhook,
  registrarWebhookNaConta,
  urlDoWebhookDaAcademia,
} from "../_shared/webhookAcademia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Acao = "criar" | "existente" | "situacao" | "documentos" | "modo_cobranca";

/**
 * Avisa a ArkeFit pelo canal dos alertas: e-mail do remetente de alertas para
 * os sócios e o Financeiro (`emails_da_area`), como o alerta de rotinas. A troca já está gravada
 * e na auditoria; o e-mail que falha fica no log só com o status, e não desfaz
 * nada.
 */
async function avisarArkefit(admin: SupabaseClient, m: { assunto: string; texto: string; html: string }): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("asaas-conta-academia: RESEND_API_KEY ausente, troca de carteira sem aviso por e-mail");
    return false;
  }
  // O aviso de dinheiro vai aos sócios e ao Financeiro (`emails_da_area`, 08/10/2026).
  const { data: destinatarios, error } = await admin.rpc("emails_da_area", { _area: "financeiro" });
  if (error) {
    console.error("asaas-conta-academia: falhou ao ler os destinatários", error.code);
    return false;
  }
  const para = [...new Set(((destinatarios ?? []) as { email: string }[]).map((d) => d.email).filter(Boolean))];
  if (!para.length) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      signal: AbortSignal.timeout(15_000),
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>",
        to: para,
        subject: m.assunto,
        html: m.html,
        text: m.texto,
      }),
    });
    // Só o status vai para log: a resposta do Resend ecoa os endereços.
    if (!r.ok) console.error("asaas-conta-academia: Resend recusou o aviso da troca", r.status);
    return r.ok;
  } catch (e) {
    console.error("asaas-conta-academia: aviso da troca não saiu", e instanceof Error ? e.name : typeof e);
    return false;
  }
}

// Conta Asaas da academia — etapa "Recebimentos" do onboarding (decisão D6):
//   criar     → o ARKE abre a subconta pela API (POST /accounts);
//   existente → a academia que já tem conta informa a carteira (walletId);
//   situacao  → consulta a aprovação da subconta criada pelo ARKE.
//   modo_cobranca → liga ou desliga a cobrança na conta da academia (só a
//               ArkeFit, verificada): registra o webhook na conta dela.
//
// `criar` é BaaS (resposta do Asaas de 06/10/2026): só com o interruptor
// `asaas_subcontas_baas` ligado e com o aceite dos Termos do Asaas pela
// gestão. A subconta que já existe segue com a situação, a nota fiscal e a
// saída do aluno, com o interruptor em qualquer posição.
//
// Gestor da organização ou ArkeFit. As colunas asaas_* são travadas para o
// gestor no banco (trg_proteger_colunas_organizacao): só esta função, com a
// service_role, grava — depois de conferir a carteira.
servir("asaas-conta-academia", async (req: Request) => {
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
    const corpo = (await req.json()) as {
      organization_id?: string;
      acao?: Acao;
      wallet_id?: string;
      aceite_termos?: unknown;
      termos_url?: unknown;
      ligar?: unknown;
    };
    const { organization_id: organizationId, acao, wallet_id: walletBruta } = corpo;
    if (!organizationId || !acao || !["criar", "existente", "situacao", "documentos", "modo_cobranca"].includes(acao)) {
      return jsonResponse({ error: "Pedido inválido." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Papel conferido com a organização fixada (unique(organization_id, user_id)),
    // não com "o vínculo de gestor" do chamador — a armadilha do vínculo duplo.
    // O ramo da ArkeFit (08/10/2026, os níveis da equipe): a conta das
    // cobranças da academia é da área `financeiro` (o Financeiro e o Sócio),
    // perguntada ao banco com a sessão de quem chama (`acesso_arkefit`), que
    // exige as duas etapas. O ramo do gestor não muda.
    const [{ data: vinculo }, arkefitNoBanco] = await Promise.all([
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle(),
      verificada(claims?.claims) ? acessoArkefit(asUser, claims?.claims, "financeiro") : Promise.resolve(false),
    ]);
    // Sem a resposta do banco, o gestor segue como gestor; quem não é, recebe erro nosso.
    if (arkefitNoBanco === null && vinculo?.role !== "gestor") {
      return jsonResponse({ error: "Não foi possível conferir o acesso agora. Tente de novo." }, 500);
    }
    const arkefit = arkefitNoBanco === true;
    if (!arkefit && vinculo?.role !== "gestor") {
      return jsonResponse({ error: "Só o gestor da academia configura a conta de recebimentos." }, 403);
    }
    if (!(await dentroDoFreio(admin, regrasAsaas(callerId, organizationId)))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select(
        "id, nome, status, razao_social, cnpj_cpf, email_contato, telefone, cep, logradouro, numero, complemento, bairro, tipo_empresa, faturamento_mensal, responsavel_nascimento, asaas_wallet_id, asaas_conta_id, asaas_conta_origem, asaas_conta_status, cobranca_conta_academia"
      )
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError || !org) return jsonResponse({ error: "Organização não encontrada." }, 404);

    // Organização em trial é homologação: fala com o sandbox do Asaas.
    const ambiente = ambienteAsaas(org.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const asaasApiUrl = ambiente.api;
    const asaasApiKey = ambiente.chave;

    // ── Cobrança na conta da academia ───────────────────────────────────
    // Só a ArkeFit, verificada em duas etapas. Ligar registra o webhook na
    // conta da academia (o aviso de pagamento de lá chega em
    // `asaas-webhook?org=<id>`), com um token novo cujo hash vai ao banco
    // junto com o modo e a auditoria. O modo vale para cobrança nova: com
    // assinatura de plano viva na conta da ArkeFit, ligar é recusado.
    if (acao === "modo_cobranca") {
      if (!arkefit) {
        return jsonResponse({ error: "Só a equipe ArkeFit, com a verificação em duas etapas, muda a conta das cobranças." }, 403);
      }
      if (typeof corpo.ligar !== "boolean") return jsonResponse({ error: "Pedido inválido." }, 400);

      const definir = async (ligar: boolean, extras: { ambiente: string | null; hash: string | null; webhook: string | null }) => {
        const { data, error } = await admin.rpc("definir_cobranca_conta_academia", {
          _organization_id: org.id,
          _ligar: ligar,
          _ator_user_id: callerId,
          _ambiente: extras.ambiente,
          _token_hash: extras.hash,
          _asaas_webhook_id: extras.webhook,
        });
        if (error) {
          // P0001: a recusa com a contagem (assinatura viva na outra conta).
          if (error.code === "P0001") return jsonResponse({ error: error.message, cobrancas_vivas: Number(error.details ?? 0) || null }, 409);
          console.error("asaas-conta-academia: falhou ao gravar o modo", resumoDoErro(error));
          return jsonResponse({ error: "Não foi possível gravar a mudança. Tente de novo." }, 500);
        }
        return null as Response | null;
      };

      if (!corpo.ligar) {
        const falha = await definir(false, { ambiente: null, hash: null, webhook: null });
        // O webhook fica registrado: estorno de cobrança antiga ainda chega por ele.
        return falha ?? jsonResponse({ ok: true, ligado: false });
      }

      if (!org.asaas_wallet_id) {
        return jsonResponse({ error: "A academia ainda não configurou a conta de recebimentos (Onboarding → Recebimentos)." }, 422);
      }
      // A recusa antes de mexer no Asaas: o banco recusa de novo, na mesma
      // transação que liga o modo.
      const { count: vivas, error: erroVivas } = await admin
        .from("aluno_matriculas_academia")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id)
        .eq("conta_asaas", "arkefit")
        .in("status", ["ativa", "pausada"])
        .not("asaas_subscription_id", "is", null);
      if (erroVivas) return jsonResponse({ error: "Não foi possível conferir as assinaturas agora. Tente de novo." }, 500);
      if (vivas) {
        return jsonResponse(
          {
            error: `Há ${vivas} assinatura(s) de plano viva(s) na conta da ArkeFit para esta academia. O modo vale só para cobrança nova e não migra assinatura: cancele ou deixe terminar essas antes de ligar.`,
            cobrancas_vivas: vivas,
          },
          409,
        );
      }
      // A chave da conta da academia (a do cofre, da nota fiscal), conferida
      // contra a carteira que recebe hoje.
      const conta = await contaDaCobranca(admin, ambiente, org, "academia", { conferirCarteira: true });
      if ("erro" in conta) return jsonResponse({ error: conta.erro }, conta.status);

      const token = gerarTokenWebhook();
      const registro = await registrarWebhookNaConta(conta.api, conta.chave, {
        url: urlDoWebhookDaAcademia(supabaseUrl, org.id as string),
        token,
      });
      if (!registro.ok) {
        console.error("asaas-conta-academia: o Asaas não registrou o webhook da academia");
        return jsonResponse({ error: `O Asaas não registrou o aviso de pagamento na conta da academia: ${registro.erro}` }, 502);
      }
      const falha = await definir(true, { ambiente: conta.ambiente, hash: await hashDoTokenWebhook(token), webhook: registro.id });
      return falha ?? jsonResponse({ ok: true, ligado: true, webhook: registro.atualizado ? "atualizado" : "registrado" });
    }

    // ── Academia que já tem conta Asaas ─────────────────────────────────
    if (acao === "existente") {
      const walletId = (walletBruta ?? "").trim().toLowerCase();
      if (!walletIdValido(walletId)) {
        return jsonResponse(
          { error: "Identificação da carteira inválida. No Asaas, ela fica em Minha Conta → Integrações → Wallet ID (formato 00000000-0000-0000-0000-000000000000)." },
          400
        );
      }
      if (org.asaas_conta_origem === "criada" && !arkefit) {
        return jsonResponse(
          { error: "A conta Asaas desta academia foi aberta pelo ARKE. Para trocar a carteira, fale com o suporte da ArkeFit." },
          409
        );
      }
      const anterior = (org.asaas_wallet_id as string | null) ?? null;
      if (anterior && !ehTrocaDeCarteira(anterior, walletId)) {
        // A mesma carteira de novo: nada muda.
        return jsonResponse({ ok: true, wallet_id: anterior, origem: org.asaas_conta_origem, ja_configurada: true });
      }
      // Trocar a carteira manda o split das próximas cobranças para outra
      // conta: com uma sessão roubada, é desviar o dinheiro da academia. A
      // troca pede as duas etapas (a ArkeFit já chega verificada); a primeira
      // vinculação, no onboarding, não.
      const troca = ehTrocaDeCarteira(anterior, walletId);
      if (troca && !verificada(claims?.claims)) {
        return jsonResponse({ error: "Trocar a carteira de recebimento pede a verificação em duas etapas.", duas_etapas: true }, 403);
      }
      // Split para a própria carteira é recusado pelo Asaas ("Não é permitido
      // split para sua própria carteira"): a carteira da ArkeFit nunca serve.
      const proprias = await carteirasProprias(asaasApiUrl, asaasApiKey);
      if (proprias === null) {
        return jsonResponse({ error: "Não foi possível conferir a carteira no Asaas agora. Tente de novo em instantes." }, 502);
      }
      if (proprias.includes(walletId)) {
        return jsonResponse({ error: "Essa é a carteira da ArkeFit. Informe a carteira da conta Asaas da academia." }, 400);
      }
      const { data: outra, error: erroOutra } = await admin
        .from("organizations")
        .select("id")
        .eq("asaas_wallet_id", walletId)
        .neq("id", org.id)
        .limit(1)
        .maybeSingle();
      if (erroOutra) return jsonResponse({ error: "Não foi possível conferir a carteira agora. Tente de novo." }, 500);
      if (outra) return jsonResponse({ error: "Essa carteira já está vinculada a outra academia no ARKE." }, 409);

      // A carteira e o registro na auditoria gravam juntos, na mesma transação.
      const { error } = await admin.rpc("definir_carteira_recebimento", {
        _organization_id: org.id,
        _wallet_id: walletId,
        _ator_user_id: callerId,
        _papel: arkefit ? "arkefit" : "gestor",
      });
      if (error) {
        console.error("asaas-conta-academia: falhou ao gravar a carteira", error.code);
        return jsonResponse({ error: "Não foi possível salvar a carteira." }, 500);
      }
      if (troca) {
        const aviso = avisoDeTrocaDeCarteira({
          academia: org.nome as string,
          papel: arkefit ? "arkefit" : "gestor",
          anterior,
          nova: walletId,
          quando: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date()),
          painel: `${Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br"}/#/superadmin`,
        });
        await avisarArkefit(admin, aviso);
      }
      return jsonResponse({
        ok: true,
        wallet_id: walletId,
        origem: "existente",
        trocada: troca,
        ...(troca ? { aviso: "As notas fiscais novas esperam a chave da conta nova, em Financeiro → Notas fiscais." } : {}),
      });
    }

    // ── Situação da subconta criada pelo ARKE ───────────────────────────
    if (acao === "situacao") {
      if (org.asaas_conta_origem !== "criada") {
        return jsonResponse({ error: "A situação só é acompanhada aqui para contas abertas pelo ARKE." }, 409);
      }
      const { data: chaveSubconta } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: org.id });
      if (!chaveSubconta) {
        return jsonResponse(
          { error: "Esta conta foi recuperada de uma tentativa anterior e não temos acesso à situação dela. Acompanhe a aprovação no painel do Asaas." },
          409
        );
      }
      const r = await consultarSituacao(asaasApiUrl, String(chaveSubconta));
      if (!r.ok) return jsonResponse({ error: r.erro }, 502);
      await admin
        .from("organizations")
        .update({ asaas_conta_status: r.situacao.general, asaas_conta_status_em: new Date().toISOString() })
        .eq("id", org.id);
      return jsonResponse({ ok: true, situacao: r.situacao });
    }

    // ── O caminho BaaS: abrir a subconta e mandar os documentos ─────────
    // Atrás do interruptor: desligado, a conta própria é o único caminho, e
    // só a organização em trial (o sandbox) abre — é a homologação.
    const { data: interruptor, error: erroInterruptor } = await admin
      .from("plataforma_config")
      .select("valor")
      .eq("chave", "asaas_subcontas_baas")
      .maybeSingle();
    if (erroInterruptor) return jsonResponse({ error: "Não foi possível conferir a configuração agora. Tente de novo." }, 500);
    if (!subcontaDisponivel(interruptor?.valor as number | null | undefined, org.status as string)) {
      return jsonResponse({ error: SUBCONTA_DESLIGADA, subcontas_desligadas: true }, 409);
    }

    // Os documentos que o Asaas pede, com o link de envio de cada grupo:
    // no BaaS a academia não vai ao painel do Asaas, o ARKE abre o link.
    if (acao === "documentos") {
      if (org.asaas_conta_origem !== "criada") {
        return jsonResponse({ error: "Os documentos só são acompanhados aqui para contas abertas pela ArkeFit." }, 409);
      }
      const { data: chaveSubconta, error: erroChave } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: org.id });
      if (erroChave) return jsonResponse({ error: "Não foi possível ler a chave da conta agora. Tente de novo." }, 500);
      if (!chaveSubconta) {
        return jsonResponse({ error: "Esta conta foi recuperada de uma tentativa anterior e não temos acesso aos documentos dela. Acompanhe no painel do Asaas." }, 409);
      }
      const r = await documentosDaSubconta(asaasApiUrl, String(chaveSubconta));
      if (!r.ok) return jsonResponse({ error: r.erro }, 502);
      return jsonResponse({ ok: true, grupos: r.grupos, motivo_recusa: r.motivoRecusa });
    }
    if (org.asaas_wallet_id) {
      return jsonResponse({ ok: true, wallet_id: org.asaas_wallet_id, origem: org.asaas_conta_origem, ja_configurada: true });
    }
    // A conta é do titular, no Asaas: quem aceita os Termos do Asaas é a
    // gestão da academia, e não a ArkeFit por ela — nem numa sessão simulada.
    if (vinculo?.role !== "gestor") {
      return jsonResponse({ error: "Quem abre a conta e aceita os Termos do Asaas é a gestão da academia, titular da conta." }, 403);
    }
    let simulada: boolean;
    try {
      simulada = await sessaoSimulada(admin, claims?.claims);
    } catch {
      return jsonResponse({ error: "Não foi possível conferir a sessão. Tente de novo." }, 500);
    }
    if (simulada) return jsonResponse({ error: MENSAGEM_PERFIL_SIMULADO }, 403);
    const aceite = aceiteDosTermos(corpo);
    if (!aceite.ok) return jsonResponse({ error: aceite.erro }, 422);
    const montado = montarSubconta({ ...org, faturamento_mensal: org.faturamento_mensal === null ? null : Number(org.faturamento_mensal) });
    if (!montado.ok) {
      return jsonResponse({ error: `Complete os dados do cadastro antes: ${montado.faltando.join(", ")}.` }, 400);
    }

    // O aceite fica antes da conta: quem, quando e qual endereço dos termos.
    const { error: erroAceite } = await admin
      .from("aceites_termos_asaas")
      .insert({ organization_id: org.id, aceito_por: callerId, termos_url: TERMOS_ASAAS_URL });
    if (erroAceite) {
      console.error("asaas-conta-academia: o aceite dos termos não foi gravado", resumoDoErro(erroAceite));
      return jsonResponse({ error: "Não foi possível registrar o aceite dos Termos do Asaas. Tente de novo." }, 500);
    }

    const r = await criarOuAdotarSubconta(asaasApiUrl, asaasApiKey, montado.payload);
    if (!r.ok) return jsonResponse({ error: r.erro }, r.status);

    // A chave primeiro: se a gravação da organização falhar, a próxima
    // tentativa adota a subconta pelo CNPJ — e a chave já está guardada.
    if (r.apiKey) {
      const { error: erroChave } = await admin.rpc("guardar_chave_subconta_asaas", { _organization_id: org.id, _chave: r.apiKey });
      if (erroChave) console.error("Falha ao guardar a chave da subconta no Vault", erroChave.code);
    }
    const { error: erroOrg } = await admin
      .from("organizations")
      .update({
        asaas_wallet_id: r.walletId,
        asaas_conta_id: r.id,
        asaas_conta_origem: "criada",
        asaas_conta_status: "PENDING",
        asaas_conta_status_em: new Date().toISOString(),
      })
      .eq("id", org.id);
    if (erroOrg) {
      return jsonResponse({ error: "A conta foi aberta no Asaas, mas não foi possível salvar aqui. Tente de novo: ela será recuperada, não duplicada." }, 500);
    }
    return jsonResponse({ ok: true, wallet_id: r.walletId, origem: "criada", adotada: r.adotada, email: montado.payload.email });
  } catch (erro) {
    console.error("asaas-conta-academia: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

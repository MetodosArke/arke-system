import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { dentroDoFreio, MENSAGEM_FREIO, regrasAsaas } from "../_shared/freio.ts";
import {
  cancelarCobranca,
  cobrancaPorReferencia,
  emitirCobrancaAvulsa,
  validarCobrancaAvulsa,
  type CobrancaAsaas,
} from "./fluxo.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { contaDaLinha, contaParaNovaCobranca, divisaoDaCobranca } from "../_shared/contaCobranca.ts";
import { contaDaCobranca, lembrarClienteDaAcademia } from "../_shared/contaDaAcademia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Cobrança avulsa ao aluno — taxa de matrícula, avaliação física, personal,
// diária, produto. Ver a migration 20261276010000 para o desenho.
//
// Três ações:
//   criar     — valida, grava a linha e emite no Asaas com split para a academia;
//   cancelar  — remove no Asaas e marca cancelada (a já paga não se cancela);
//   reemitir  — para a emissão que não se confirmou (rede, tempo): procura a
//               cobrança pela referência antes de criar, então nunca duplica.
//
// Só a gestão e a recepção da academia do aluno emitem e cancelam: é quem
// lida com dinheiro na academia, a mesma regra da situação do aluno.
//
// A conta: com `organizations.cobranca_conta_academia` desligado (o padrão),
// a cobrança sai da conta da ArkeFit com split para a academia, como sempre.
// Ligado, a cobrança nova sai da conta Asaas da academia, sem split e sem a
// taxa de processamento. Cancelar e reemitir vão à conta onde a linha nasceu
// (`conta_asaas`), qualquer que seja o modo de hoje.

const PAPEIS_QUE_COBRAM = ["gestor", "recepcao"];

type Linha = {
  id: string;
  organization_id: string;
  aluno_id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  valor_liquido_academia: number;
  asaas_payment_id: string | null;
  conta_asaas: string | null;
};

async function papelNaOrganizacao(admin: SupabaseClient, userId: string, organizationId: string): Promise<string | null> {
  // Organização fixada: quem tem vínculo em duas academias não cai na
  // armadilha do vínculo duplo (`unique(organization_id, user_id)`).
  const { data } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

async function dadosDoAluno(admin: SupabaseClient, alunoId: string) {
  const { data: aluno } = await admin
    .from("alunos")
    .select("id, user_id, anonimizado_em")
    .eq("id", alunoId)
    .maybeSingle();
  if (!aluno) return null;
  const { data: perfil } = await admin
    .from("profiles")
    .select("full_name, cpf, phone")
    .eq("user_id", aluno.user_id)
    .maybeSingle();
  return {
    anonimizado: !!aluno.anonimizado_em,
    alunoId: aluno.id as string,
    nome: (perfil?.full_name as string | undefined) || "Aluno ARKE",
    cpf: String(perfil?.cpf ?? "").replace(/\D/g, ""),
    telefone: String(perfil?.phone ?? "").replace(/\D/g, "") || null,
  };
}

/** Grava o que o Asaas devolveu. Falhar aqui não perde nada: o webhook preenche pela referência. */
async function registrarEmissao(admin: SupabaseClient, linhaId: string, c: CobrancaAsaas) {
  const { error } = await admin
    .from("cobrancas_avulsas")
    .update({ asaas_payment_id: c.id, invoice_url: c.invoiceUrl ?? null, emitida_em: new Date().toISOString() })
    .eq("id", linhaId);
  if (error) console.error("Cobrança emitida, mas não gravada; o webhook completa", linhaId, error.code);
}

servir("asaas-cobranca-avulsa", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const acao = String(corpo.acao ?? "criar");

    // --- Qual academia, e se quem pede pode cobrar nela ---------------------
    let organizationId: string;
    let linha: Linha | null = null;
    if (acao === "criar") {
      const alunoId = String(corpo.aluno_id ?? "");
      if (!alunoId) return jsonResponse({ error: "Aluno não informado." }, 400);
      // O RLS de `alunos` decide quem enxerga: quem não enxerga recebe 404.
      const { data: visivel } = await asUser.from("alunos").select("id, organization_id").eq("id", alunoId).maybeSingle();
      if (!visivel) return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);
      organizationId = visivel.organization_id as string;
    } else if (acao === "cancelar" || acao === "reemitir") {
      const cobrancaId = String(corpo.cobranca_id ?? "");
      if (!cobrancaId) return jsonResponse({ error: "Cobrança não informada." }, 400);
      const { data } = await admin
        .from("cobrancas_avulsas")
        .select("id, organization_id, aluno_id, descricao, valor, vencimento, status, valor_liquido_academia, asaas_payment_id, conta_asaas")
        .eq("id", cobrancaId)
        .maybeSingle();
      if (!data) return jsonResponse({ error: "Cobrança não encontrada." }, 404);
      linha = data as Linha;
      organizationId = linha.organization_id;
    } else {
      return jsonResponse({ error: "Ação desconhecida." }, 400);
    }

    const papel = await papelNaOrganizacao(admin, callerId, organizationId);
    if (!papel || !PAPEIS_QUE_COBRAM.includes(papel)) {
      // Para a ação sobre uma linha, não confirmar que ela existe a quem não é da academia.
      return papel === null && linha
        ? jsonResponse({ error: "Cobrança não encontrada." }, 404)
        : jsonResponse({ error: "Só a gestão e a recepção da academia emitem ou cancelam cobranças." }, 403);
    }
    if (!(await dentroDoFreio(admin, regrasAsaas(callerId, organizationId)))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("id, nome, status, asaas_wallet_id, onboarding_completed, cobranca_conta_academia")
      .eq("id", organizationId)
      .single();
    if (!org) return jsonResponse({ error: "Organização não encontrada." }, 404);

    const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
    if ("erro" in ambiente) return jsonResponse({ error: ambiente.erro }, 500);

    // --- Cancelar -------------------------------------------------------------
    if (acao === "cancelar") {
      const l = linha!;
      if (l.status !== "pendente" && l.status !== "atrasado") {
        return jsonResponse({ error: "Só dá para cancelar cobrança em aberto." }, 409);
      }
      // Na conta onde a cobrança nasceu, e não na do modo de hoje.
      const conta = await contaDaCobranca(admin, ambiente, org, contaDaLinha(l.conta_asaas), { conferirCarteira: false });
      if ("erro" in conta) return jsonResponse({ error: conta.erro }, conta.status);
      let paymentId = l.asaas_payment_id;
      if (!paymentId) {
        // Emissão não confirmada: pode existir lá mesmo assim.
        try {
          paymentId = (await cobrancaPorReferencia(conta.api, conta.chave, `avulsa:${l.id}`))?.id ?? null;
        } catch {
          return jsonResponse({ error: "Não foi possível falar com o Asaas agora. Tente de novo em instantes." }, 502);
        }
      }
      if (paymentId) {
        const r = await cancelarCobranca(conta.api, conta.chave, paymentId);
        if (!r.ok) return jsonResponse({ error: r.erro }, r.paga ? 409 : 502);
      }
      await admin
        .from("cobrancas_avulsas")
        .update({ status: "cancelado", cancelada_por: callerId, cancelada_em: new Date().toISOString() })
        .eq("id", l.id);
      return jsonResponse({ ok: true, status: "cancelado" });
    }

    // --- Criar e reemitir: as travas da cobrança da academia -----------------
    if (!org.asaas_wallet_id) {
      return jsonResponse(
        { error: "A academia ainda não configurou a conta de recebimentos no Asaas (Onboarding → Recebimentos)." },
        422,
      );
    }
    // D5: cobrança de aluno só com o onboarding concluído (trial é homologação).
    if (!org.onboarding_completed && org.status !== "trial") {
      return jsonResponse({ error: "Conclua o onboarding da academia (Painel → Onboarding) antes de cobrar alunos pelo ARKE." }, 422);
    }

    const hoje = hojeBrasilia();

    if (acao === "reemitir") {
      const l = linha!;
      if (l.status !== "pendente" || l.asaas_payment_id) {
        return jsonResponse({ error: "Esta cobrança já foi emitida." }, 409);
      }
      const aluno = await dadosDoAluno(admin, l.aluno_id);
      if (!aluno || aluno.anonimizado) return jsonResponse({ error: "Aluno não encontrado." }, 404);
      // Emissão que ficou para trás não pode sair com vencimento no passado.
      // Na conta onde a linha nasceu: a referência é procurada lá antes de criar.
      const contaGravada = contaDaLinha(l.conta_asaas);
      const conta = await contaDaCobranca(admin, ambiente, org, contaGravada, { conferirCarteira: true });
      if ("erro" in conta) return jsonResponse({ error: conta.erro }, conta.status);
      const vencimento = l.vencimento < hoje ? hoje : l.vencimento;
      if (vencimento !== l.vencimento) await admin.from("cobrancas_avulsas").update({ vencimento }).eq("id", l.id);
      const r = await emitirCobrancaAvulsa(conta.api, conta.chave, {
        referencia: `avulsa:${l.id}`,
        aluno,
        valor: Number(l.valor),
        vencimento,
        descricao: `${org.nome} — ${l.descricao}`,
        walletAcademia: contaGravada === "academia" ? null : (org.asaas_wallet_id as string),
        valorLiquidoAcademia: Number(l.valor_liquido_academia),
      });
      if (!r.ok) {
        if (r.definitivo) await admin.from("cobrancas_avulsas").delete().eq("id", l.id);
        return jsonResponse({ error: r.definitivo ? `${r.erro} A cobrança foi desfeita.` : r.erro }, r.definitivo ? 422 : 502);
      }
      await registrarEmissao(admin, l.id, r.cobranca);
      if (conta.nome === "academia" && r.cobranca.customer) {
        await lembrarClienteDaAcademia(admin, { alunoId: l.aluno_id, organizationId, ambiente: conta.ambiente, customerId: r.cobranca.customer });
      }
      return jsonResponse({ ok: true, cobranca_id: l.id, invoice_url: r.cobranca.invoiceUrl ?? null, adotada: r.adotada });
    }

    // criar
    const validacao = validarCobrancaAvulsa(corpo, hoje);
    if (validacao.ok === false) return jsonResponse({ error: validacao.erro }, 400);
    const pedido = validacao.pedido;

    const alunoId = String(corpo.aluno_id);
    const aluno = await dadosDoAluno(admin, alunoId);
    if (!aluno || aluno.anonimizado) return jsonResponse({ error: "Aluno não encontrado." }, 404);
    if (aluno.cpf.length !== 11) {
      return jsonResponse(
        { error: "Cadastre o CPF do aluno (ficha do aluno) antes de cobrar — o Asaas exige CPF para emitir a cobrança." },
        422,
      );
    }

    // A conta da cobrança nova: a da ArkeFit, ou a da academia com o modo
    // ligado. Aberta antes de gravar a linha, para a chave que falta ou é de
    // outra conta parar aqui, e não numa linha que depois se desfaz.
    const conta = await contaDaCobranca(
      admin,
      ambiente,
      org,
      contaParaNovaCobranca("avulsa", org.cobranca_conta_academia as boolean | null),
      { conferirCarteira: true },
    );
    if ("erro" in conta) return jsonResponse({ error: conta.erro }, conta.status);

    // Na conta da ArkeFit, o mesmo split da mensalidade: a academia recebe o
    // valor menos a taxa de processamento, que fica com a ArkeFit para cobrir
    // a taxa do Asaas. Na conta da academia, não há taxa nem split.
    let taxaArke: number | null = null;
    if (conta.nome === "arkefit") {
      const { data: taxa, error: taxaError } = await admin.rpc("arke_taxa_processamento", { _valor: pedido.valor });
      if (taxaError || taxa === null || taxa === undefined) {
        console.error("Taxa de processamento indisponível", taxaError?.code);
        return jsonResponse({ error: "Não foi possível calcular a taxa de processamento." }, 500);
      }
      taxaArke = Number(taxa);
    }
    const divisao = divisaoDaCobranca(conta.nome, pedido.valor, taxaArke, org.asaas_wallet_id as string);
    if ("erro" in divisao) return jsonResponse({ error: divisao.erro }, 500);
    const repasse = divisao.repasse;
    const liquido = divisao.liquido;
    if (liquido <= 0) {
      return jsonResponse({ error: `O valor não cobre a taxa de processamento (${repasse.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).` }, 422);
    }

    // A linha nasce antes do Asaas: é o id dela que vai na referência.
    const { data: criada, error: insertError } = await admin
      .from("cobrancas_avulsas")
      .insert({
        organization_id: organizationId,
        aluno_id: alunoId,
        tipo: pedido.tipo,
        descricao: pedido.descricao,
        valor: pedido.valor,
        vencimento: pedido.vencimento,
        valor_repasse_arke: repasse,
        valor_liquido_academia: liquido,
        conta_asaas: conta.nome,
        criada_por: callerId,
      })
      .select("id")
      .single();
    if (insertError || !criada) {
      console.error("Falha ao registrar cobrança avulsa", insertError?.code);
      return jsonResponse({ error: "Não foi possível registrar a cobrança." }, 500);
    }

    const r = await emitirCobrancaAvulsa(conta.api, conta.chave, {
      referencia: `avulsa:${criada.id}`,
      aluno,
      valor: pedido.valor,
      vencimento: pedido.vencimento,
      descricao: `${org.nome} — ${pedido.descricao}`,
      walletAcademia: divisao.split ? divisao.split[0].walletId : null,
      valorLiquidoAcademia: liquido,
    });
    if (!r.ok) {
      if (r.definitivo) {
        // O Asaas recusou e nada foi criado lá: a linha sai, para não ficar
        // uma cobrança fantasma na ficha.
        await admin.from("cobrancas_avulsas").delete().eq("id", criada.id);
        return jsonResponse({ error: r.erro }, 422);
      }
      // Pode ter sido criada lá. A linha fica, e "tentar de novo" adota.
      return jsonResponse(
        {
          error: `${r.erro} A cobrança ficou na ficha como "emissão não confirmada" — use "Tentar de novo"; se ela já existir no Asaas, é aproveitada, não duplicada.`,
          cobranca_id: criada.id,
        },
        502,
      );
    }
    await registrarEmissao(admin, criada.id, r.cobranca);
    if (conta.nome === "academia" && r.cobranca.customer) {
      await lembrarClienteDaAcademia(admin, { alunoId, organizationId, ambiente: conta.ambiente, customerId: r.cobranca.customer });
    }
    return jsonResponse({
      ok: true,
      conta: conta.nome,
      cobranca_id: criada.id,
      invoice_url: r.cobranca.invoiceUrl ?? null,
      valor_liquido_academia: liquido,
      valor_repasse_arke: repasse,
    });
  } catch (error) {
    console.error("asaas-cobranca-avulsa error", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao processar a cobrança." }, 500);
  }
});

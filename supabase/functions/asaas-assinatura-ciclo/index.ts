import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import {
  alterarValorAssinatura,
  cancelarAssinatura,
  pausarAssinatura,
  retomarAssinatura,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Acao = "cancelar" | "pausar" | "retomar" | "alterar_valor";
const ACOES: Acao[] = ["cancelar", "pausar", "retomar", "alterar_valor"];
type Tipo = "metodo" | "plano";

// Ciclo de vida da cobrança recorrente do aluno — a assinatura do Método ARKE
// (`tipo: "metodo"`, o padrão) ou a mensalidade do plano da academia
// (`tipo: "plano"`): cancelar, pausar, retomar e alterar valor. As duas moram
// na conta Asaas da ArkeFit, com split para a academia; o que muda entre elas
// é a tabela, o repasse e quem pode cancelar.
//
// Faltava inteiro, e a ausência puxava sempre para o lado mais caro — cobrar
// quem não deve. Excluir um aluno apagava a linha daqui por `cascade` e
// deixava a assinatura viva no Asaas; pausar tirava o acesso e mantinha a
// cobrança; mudar o preço de varejo não alcançava quem já era assinante.
//
// Ordem das chamadas: **gateway primeiro, banco depois**. Se o Asaas recusa,
// nada mudou. Se o banco falha depois de o gateway aceitar, o aluno fica sem
// cobrança e com acesso por um tempo — erro que não custa dinheiro a ninguém,
// ao contrário do inverso. E o `PAYMENT_DELETED` que o Asaas dispara corrige
// as cobranças por conta própria.
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
    const { aluno_id: alunoId, acao, motivo, valor_cobrado: valorCobrado, tipo: tipoPedido } = (await req.json()) as {
      aluno_id?: string;
      acao?: Acao;
      motivo?: string;
      valor_cobrado?: number;
      tipo?: Tipo;
    };
    if (!alunoId || !acao || !ACOES.includes(acao)) return jsonResponse({ error: "Pedido inválido." }, 400);
    if (tipoPedido !== undefined && tipoPedido !== "metodo" && tipoPedido !== "plano") {
      return jsonResponse({ error: "Pedido inválido." }, 400);
    }
    const tipo: Tipo = tipoPedido ?? "metodo";
    const tabela = tipo === "metodo" ? "aluno_assinaturas" : "aluno_matriculas_academia";
    // Onde ficam as cobranças de cada uma, e a coluna que liga à assinatura.
    const cobrancas =
      tipo === "metodo" ? { tabela: "pagamentos", fk: "aluno_assinatura_id" } : { tabela: "mensalidades", fk: "matricula_id" };

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: aluno } = await admin
      .from("alunos")
      .select("id, user_id, organization_id")
      .eq("id", alunoId)
      .maybeSingle();
    if (!aluno) return jsonResponse({ error: "Aluno não encontrado." }, 404);

    // Papel conferido com a organização do aluno fixada — nunca "o vínculo do
    // chamador" —, porque quem é gestor de uma academia e professor de outra
    // faria a consulta por `user_id` devolver duas linhas. É a armadilha do
    // vínculo duplo.
    const [{ data: vinculo }, { data: papeis }] = await Promise.all([
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", aluno.organization_id)
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", callerId),
    ]);
    const arkefit = verificada(claims?.claims) && (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
    const equipe = vinculo?.role === "gestor" || vinculo?.role === "recepcao";
    const oProprioAluno = aluno.user_id === callerId;

    // Cancelar a própria assinatura do Método é direito de quem paga. O plano
    // é contrato com a academia (pode ter fidelidade), então sai pela
    // recepção. Pausar, retomar e mudar o preço são decisões da operação.
    const autorizado =
      acao === "cancelar" && tipo === "metodo" ? equipe || arkefit || oProprioAluno : equipe || arkefit;
    if (!autorizado) {
      return jsonResponse({ error: "Você não tem permissão para alterar a cobrança deste aluno." }, 403);
    }

    const { data: assinatura } =
      tipo === "metodo"
        ? await admin
            .from("aluno_assinaturas")
            .select("id, status, valor_cobrado, nivel_atacado, asaas_subscription_id")
            .eq("aluno_id", aluno.id)
            .maybeSingle()
        : await admin
            .from("aluno_matriculas_academia")
            .select("id, status, valor_cobrado, asaas_subscription_id")
            .eq("aluno_id", aluno.id)
            .in("status", ["ativa", "pausada"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
    if (!assinatura) {
      return jsonResponse(
        {
          error:
            tipo === "metodo"
              ? "Este aluno não tem assinatura do Método ARKE."
              : "Este aluno não tem matrícula em plano da academia.",
        },
        404,
      );
    }
    if (!assinatura.asaas_subscription_id) {
      // Trial do Super Admin (ou matrícula que não chegou ao gateway) não
      // existe no Asaas: encerra só deste lado.
      if (acao === "cancelar") {
        await admin
          .from(tabela)
          .update({
            status: "cancelada",
            cancelada_em: new Date().toISOString(),
            cancelada_por: callerId,
            cancelamento_motivo: motivo?.trim() || "Encerrado sem cobrança no gateway.",
          })
          .eq("id", assinatura.id);
        return jsonResponse({ ok: true, acao, sem_gateway: true });
      }
      return jsonResponse({ error: "Esta assinatura não tem cobrança no gateway de pagamento." }, 422);
    }

    const { data: org } = await admin
      .from("organizations")
      .select("id, status, asaas_wallet_id")
      .eq("id", aluno.organization_id)
      .maybeSingle();
    if (!org) return jsonResponse({ error: "Organização não encontrada." }, 404);

    // Organização em trial é homologação e fala com o sandbox.
    const ambiente = ambienteAsaas(org.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) return jsonResponse({ error: ambiente.erro }, 500);
    const { api, chave } = ambiente;
    const hoje = hojeBrasilia();
    const agora = new Date().toISOString();

    // ── Cancelar ────────────────────────────────────────────────────────────
    if (acao === "cancelar") {
      const motivoLimpo = motivo?.trim();
      if (!motivoLimpo) {
        return jsonResponse({ error: "Informe o motivo do cancelamento — ele fica no histórico do aluno." }, 400);
      }
      const r = await cancelarAssinatura(api, chave, assinatura.asaas_subscription_id);
      if (!r.ok) return jsonResponse({ error: r.erro }, r.status);

      await admin
        .from(tabela)
        .update({
          status: "cancelada",
          cancelada_em: agora,
          cancelada_por: callerId,
          cancelamento_motivo: motivoLimpo,
          ...(tipo === "metodo" ? { fatura_pendente_url: null } : {}),
        })
        .eq("id", assinatura.id);

      // O Asaas apaga as cobranças pendentes junto e manda `PAYMENT_DELETED`
      // de cada uma. Marcar aqui também não é redundância: webhook perdido é
      // o modo de falha que este projeto já conhece, e uma cobrança que ficou
      // `pendente` com vencimento no passado bloquearia quem não deve mais
      // nada. A dupla escrita é idempotente.
      const { data: canceladas } = await admin
        .from(cobrancas.tabela)
        .update({ status: "cancelado" })
        .eq(cobrancas.fk, assinatura.id)
        .in("status", ["pendente", "atrasado"])
        .select("id, valor, vencimento");

      return jsonResponse({
        ok: true,
        acao,
        ja_estava_cancelada: r.jaEstavaCancelada,
        cobrancas_canceladas: canceladas?.length ?? 0,
        // A academia precisa ver o que deixou de ser cobrável: cancelar
        // encerra também a dívida em aberto, porque é o que o gateway faz.
        valor_em_aberto_encerrado:
          (canceladas ?? []).reduce((s, c) => s + Number(c.valor ?? 0), 0) || 0,
      });
    }

    // ── Pausar ──────────────────────────────────────────────────────────────
    if (acao === "pausar") {
      const r = await pausarAssinatura(api, chave, assinatura.asaas_subscription_id, hoje);
      if (!r.ok) return jsonResponse({ error: r.erro }, r.status);

      await admin
        .from(tabela)
        .update({ status: "pausada", pausada_em: agora, pausada_por: callerId })
        .eq("id", assinatura.id);

      if (r.cobrancasRemovidas.length) {
        await admin
          .from(cobrancas.tabela)
          .update({ status: "cancelado" })
          .in("asaas_payment_id", r.cobrancasRemovidas);
      }
      return jsonResponse({
        ok: true,
        acao,
        cobrancas_removidas: r.cobrancasRemovidas.length,
        // Dívida de período já usado continua valendo, e a tela precisa dizer
        // isso — senão a pausa parece ter perdoado o que não perdoou.
        cobrancas_vencidas_mantidas: r.cobrancasVencidasMantidas.length,
      });
    }

    // ── Retomar ─────────────────────────────────────────────────────────────
    if (acao === "retomar") {
      if (assinatura.status !== "pausada") {
        return jsonResponse({ error: "Esta assinatura não está pausada." }, 409);
      }
      const r = await retomarAssinatura(api, chave, assinatura.asaas_subscription_id);
      if (!r.ok) return jsonResponse({ error: r.erro }, r.status);

      await admin
        .from(tabela)
        .update({ status: "ativa", pausada_em: null, pausada_por: null })
        .eq("id", assinatura.id);
      return jsonResponse({ ok: true, acao });
    }

    // ── Alterar valor ───────────────────────────────────────────────────────
    const valor = Number(valorCobrado);
    if (!Number.isFinite(valor) || valor <= 0) return jsonResponse({ error: "Informe o novo valor." }, 400);
    if (!org.asaas_wallet_id) {
      return jsonResponse({ error: "A academia ainda não configurou a conta de recebimentos." }, 422);
    }

    // O repasse sai da mesma conta da criação — no Método, o negociado mais a
    // taxa de processamento; no plano, só a taxa. Recalcular aqui é o ponto:
    // é o valor que muda quando o preço muda, e é ele que define o split.
    const { data: repasseCalculado } =
      tipo === "metodo"
        ? await admin.rpc("repasse_arke", {
            _organization_id: org.id,
            _valor_cobrado: valor,
            _nivel_atacado: (assinatura as { nivel_atacado?: string }).nivel_atacado,
          })
        : await admin.rpc("arke_taxa_processamento", { _valor: valor });
    if (repasseCalculado === null || repasseCalculado === undefined) {
      return jsonResponse(
        { error: "Esta academia ainda não tem o repasse do Método negociado. Configure em Visão Master → ficha da organização." },
        422
      );
    }
    const repasse = Math.round(Number(repasseCalculado) * 100) / 100;

    const r = await alterarValorAssinatura(api, chave, assinatura.asaas_subscription_id, {
      valorCobrado: valor,
      valorRepasseArke: repasse,
      walletAcademia: org.asaas_wallet_id,
      hoje,
    });
    if (!r.ok) return jsonResponse({ error: r.erro }, r.status);

    await admin
      .from(tabela)
      .update({
        valor_cobrado: valor,
        valor_repasse_arke: repasse,
        ...(tipo === "plano" ? { valor_liquido_academia: r.valorAcademia } : {}),
      })
      .eq("id", assinatura.id);

    // Só quando o gateway de fato atualizou as pendentes, senão o banco diria
    // um valor que a fatura do aluno não confirma.
    if (r.pendentesAtualizadas) {
      await admin
        .from(cobrancas.tabela)
        .update({ valor, valor_repasse_arke: repasse, valor_liquido_academia: r.valorAcademia })
        .eq(cobrancas.fk, assinatura.id)
        .eq("status", "pendente");
    }

    return jsonResponse({
      ok: true,
      acao,
      valor_cobrado: valor,
      valor_repasse_arke: repasse,
      valor_academia: r.valorAcademia,
      pendentes_atualizadas: r.pendentesAtualizadas,
      cobrancas_vencidas_no_valor_antigo: r.vencidasNoValorAntigo.length,
    });
  } catch (erro) {
    console.error("asaas-assinatura-ciclo: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

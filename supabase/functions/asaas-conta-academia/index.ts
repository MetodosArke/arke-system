import { createClient } from "npm:@supabase/supabase-js@2";
import {
  carteirasProprias,
  consultarSituacao,
  criarOuAdotarSubconta,
  montarSubconta,
  walletIdValido,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Acao = "criar" | "existente" | "situacao";

// Conta Asaas da academia — etapa "Recebimentos" do onboarding (decisão D6):
//   criar     → o ARKE abre a subconta pela API (POST /accounts);
//   existente → a academia que já tem conta informa a carteira (walletId);
//   situacao  → consulta a aprovação da subconta criada pelo ARKE.
//
// Gestor da organização ou ArkeFit. As colunas asaas_* são travadas para o
// gestor no banco (trg_proteger_colunas_organizacao): só esta função, com a
// service_role, grava — depois de conferir a carteira.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const asaasApiKey = Deno.env.get("ASAAS_API_KEY");
  const asaasApiUrl = Deno.env.get("ASAAS_API_URL") ?? "https://api.asaas.com/v3";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !asaasApiKey) {
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const { organization_id: organizationId, acao, wallet_id: walletBruta } = (await req.json()) as {
      organization_id?: string;
      acao?: Acao;
      wallet_id?: string;
    };
    if (!organizationId || !acao || !["criar", "existente", "situacao"].includes(acao)) {
      return jsonResponse({ error: "Pedido inválido." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Papel conferido com a organização fixada (unique(organization_id, user_id)),
    // não com "o vínculo de gestor" do chamador — a armadilha do vínculo duplo.
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
      return jsonResponse({ error: "Só o gestor da academia configura a conta de recebimentos." }, 403);
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select(
        "id, nome, razao_social, cnpj_cpf, email_contato, telefone, cep, logradouro, numero, complemento, bairro, tipo_empresa, faturamento_mensal, asaas_wallet_id, asaas_conta_id, asaas_conta_origem, asaas_conta_status"
      )
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError || !org) return jsonResponse({ error: "Organização não encontrada." }, 404);

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
      // Split para a própria carteira é recusado pelo Asaas ("Não é permitido
      // split para sua própria carteira"): a carteira da ArkeFit nunca serve.
      const proprias = await carteirasProprias(asaasApiUrl, asaasApiKey);
      if (proprias === null) {
        return jsonResponse({ error: "Não foi possível conferir a carteira no Asaas agora. Tente de novo em instantes." }, 502);
      }
      if (proprias.includes(walletId)) {
        return jsonResponse({ error: "Essa é a carteira da ArkeFit. Informe a carteira da conta Asaas da academia." }, 400);
      }
      const { data: outra } = await admin
        .from("organizations")
        .select("id")
        .eq("asaas_wallet_id", walletId)
        .neq("id", org.id)
        .limit(1)
        .maybeSingle();
      if (outra) return jsonResponse({ error: "Essa carteira já está vinculada a outra academia no ARKE." }, 409);

      const { error } = await admin
        .from("organizations")
        .update({
          asaas_wallet_id: walletId,
          asaas_conta_origem: "existente",
          asaas_conta_id: null,
          asaas_conta_status: null,
          asaas_conta_status_em: null,
        })
        .eq("id", org.id);
      if (error) return jsonResponse({ error: "Não foi possível salvar a carteira." }, 500);
      return jsonResponse({ ok: true, wallet_id: walletId, origem: "existente" });
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

    // ── Abrir a subconta ────────────────────────────────────────────────
    if (org.asaas_wallet_id) {
      return jsonResponse({ ok: true, wallet_id: org.asaas_wallet_id, origem: org.asaas_conta_origem, ja_configurada: true });
    }
    const montado = montarSubconta({ ...org, faturamento_mensal: org.faturamento_mensal === null ? null : Number(org.faturamento_mensal) });
    if (!montado.ok) {
      return jsonResponse({ error: `Complete os dados da academia antes: ${montado.faltando.join(", ")}.` }, 400);
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

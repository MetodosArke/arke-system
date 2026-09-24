import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import {
  autenticacaoEnviada,
  buscarServicos,
  cadastroFiscal,
  carteiraDaChave,
  chaveCombinaComAmbiente,
  cidadeDaConta,
  enviarCadastroFiscal,
  FalhaIndefinida,
  opcoesMunicipais,
} from "../nfse-emitir/fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Cadastro fiscal da academia para a nota automática (Financeiro → Notas
// fiscais). A academia preenche; o ARKE só transmite ao Asaas, na conta dela.
//
//   situacao  → o que a prefeitura da cidade exige, o que já foi enviado e a configuração local;
//   chave     → conecta a conta Asaas de quem informou uma carteira que já tinha;
//   servicos  → busca o serviço municipal ("ginástica");
//   cadastro  → envia o cadastro fiscal ao Asaas (multipart: pode levar o certificado);
//   config    → serviço, ISS, observação e o interruptor da emissão.
//
// Certificado, senha e token da prefeitura atravessam esta função e vão
// direto ao Asaas. Não são gravados aqui nem vão para log.

// Só o que o Asaas aceita no cadastro fiscal; o resto do formulário é ignorado.
const CAMPOS_FISCAIS = [
  "email", "simplesNacional", "municipalInscription", "specialTaxRegime", "nationalPortalTaxCalculationRegime",
  "serviceListItem", "cnae", "rpsSerie", "rpsNumber", "loteNumber", "username", "password", "accessToken",
  "certificateFile", "certificatePassword", "culturalProjectsPromoter",
];

async function papelNaOrganizacao(admin: SupabaseClient, userId: string, organizationId: string) {
  const { data } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

/** Relê do Asaas o que a prefeitura exige e o que já foi enviado, e grava o retrato. */
async function situacao(admin: SupabaseClient, orgId: string, api: string, chave: string) {
  const [opcoes, cadastro, cidade] = await Promise.all([
    opcoesMunicipais(api, chave),
    cadastroFiscal(api, chave),
    cidadeDaConta(api, chave),
  ]);
  const enviada = autenticacaoEnviada(opcoes?.authenticationType ?? null, cadastro);
  await admin.from("organizacao_fiscal").upsert(
    {
      organization_id: orgId,
      cidade: cidade.cidade,
      uf: cidade.uf,
      autenticacao: opcoes?.authenticationType ?? null,
      autenticacao_enviada: enviada,
      cadastro_enviado: !!cadastro,
      verificado_em: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  const { data: config } = await admin.from("organizacao_fiscal").select("*").eq("organization_id", orgId).maybeSingle();
  const servicoOk = !!(config?.servico_municipal_id || config?.servico_municipal_codigo) && config?.aliquota_iss !== null;
  return {
    conectada: true,
    cidade: cidade.cidade,
    uf: cidade.uf,
    opcoes,
    cadastro,
    config,
    pronta: !!cadastro && enviada && servicoOk,
  };
}

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
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    // O cadastro fiscal chega em multipart (pode trazer o certificado); o resto, em JSON.
    const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = multipart ? await req.formData() : null;
    const corpo = multipart ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const campo = (nome: string) => (form ? form.get(nome) : corpo[nome]);
    const acao = String(campo("acao") ?? "situacao");
    const orgId = String(campo("organization_id") ?? "");
    if (!orgId) return jsonResponse({ error: "Academia não informada." }, 400);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    // A configuração fiscal é do dono do CNPJ: só a gestão mexe.
    if ((await papelNaOrganizacao(admin, callerId, orgId)) !== "gestor") {
      return jsonResponse({ error: "Só a gestão da academia configura a nota fiscal." }, 403);
    }
    const { data: org } = await admin.from("organizations").select("id, status, asaas_wallet_id").eq("id", orgId).maybeSingle();
    if (!org) return jsonResponse({ error: "Academia não encontrada." }, 404);

    // Organização em trial é homologação: fala com o sandbox, e a chave dela tem de ser de sandbox.
    const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
    if ("erro" in ambiente) return jsonResponse({ error: ambiente.erro }, 500);

    if (acao === "chave") {
      const chave = String(campo("chave") ?? "").trim();
      if (!chaveCombinaComAmbiente(chave, ambiente.nome)) {
        return jsonResponse({ error: "Esta não parece uma chave de API do Asaas válida para esta conta." }, 422);
      }
      if (!org.asaas_wallet_id) {
        return jsonResponse({ error: "Configure primeiro a conta de recebimentos (Onboarding → Recebimentos)." }, 422);
      }
      // A chave tem de ser da mesma conta que recebe o split: senão a nota
      // sairia no CNPJ de outra empresa.
      const carteira = await carteiraDaChave(ambiente.api, chave);
      if (!carteira) return jsonResponse({ error: "O Asaas não aceitou esta chave." }, 422);
      if (carteira !== org.asaas_wallet_id) {
        return jsonResponse({ error: "Esta chave é de outra conta Asaas, não da que recebe os pagamentos da academia." }, 422);
      }
      const { error: erroCofre } = await admin.rpc("guardar_chave_subconta_asaas", { _organization_id: orgId, _chave: chave });
      if (erroCofre) {
        console.error("asaas-fiscal-academia: cofre recusou a chave", erroCofre.code);
        return jsonResponse({ error: "Não foi possível guardar a chave. Tente de novo." }, 500);
      }
      return jsonResponse(await situacao(admin, orgId, ambiente.api, chave));
    }

    const { data: chave } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: orgId });
    if (!chave) return jsonResponse({ conectada: false, possuiCarteira: !!org.asaas_wallet_id });
    if (!chaveCombinaComAmbiente(chave as string, ambiente.nome)) {
      return jsonResponse({ error: "A chave guardada é de outro ambiente do Asaas. Conecte a conta de novo." }, 409);
    }
    const k = chave as string;

    if (acao === "situacao") return jsonResponse(await situacao(admin, orgId, ambiente.api, k));

    if (acao === "servicos") {
      const termo = String(campo("termo") ?? "").trim();
      if (termo.length < 3) return jsonResponse({ servicos: [] });
      return jsonResponse({ servicos: await buscarServicos(ambiente.api, k, termo) });
    }

    if (acao === "cadastro") {
      if (!form) return jsonResponse({ error: "O cadastro fiscal vai como formulário." }, 400);
      const envio = new FormData();
      for (const nome of CAMPOS_FISCAIS) {
        const v = form.get(nome);
        if (v === null || v === "") continue;
        envio.append(nome, v);
      }
      const r = await enviarCadastroFiscal(ambiente.api, k, envio);
      if (!r.ok) return jsonResponse({ error: r.erro }, 422);
      await admin.from("organizacao_fiscal").upsert({ organization_id: orgId, atualizado_por: callerId }, { onConflict: "organization_id" });
      return jsonResponse(await situacao(admin, orgId, ambiente.api, k));
    }

    if (acao === "config") {
      const iss = corpo.aliquota_iss === null || corpo.aliquota_iss === undefined || corpo.aliquota_iss === "" ? null : Number(corpo.aliquota_iss);
      if (iss !== null && (!Number.isFinite(iss) || iss < 0 || iss > 10)) {
        return jsonResponse({ error: "Alíquota de ISS entre 0 e 10%." }, 400);
      }
      const ativar = corpo.emissao_ativa === true;
      const linha = {
        organization_id: orgId,
        servico_municipal_id: corpo.servico_municipal_id ? String(corpo.servico_municipal_id) : null,
        servico_municipal_codigo: corpo.servico_municipal_codigo ? String(corpo.servico_municipal_codigo).slice(0, 30) : null,
        servico_municipal_nome: corpo.servico_municipal_nome ? String(corpo.servico_municipal_nome).slice(0, 300) : null,
        aliquota_iss: iss,
        observacoes: corpo.observacoes ? String(corpo.observacoes).slice(0, 400) : null,
        emissao_ativa: false,
        atualizado_por: callerId,
      };
      await admin.from("organizacao_fiscal").upsert(linha, { onConflict: "organization_id" });
      const s = await situacao(admin, orgId, ambiente.api, k);
      if (ativar) {
        // Ligar exige o cadastro pronto de verdade, conferido no Asaas agora —
        // não o retrato guardado.
        if (!s.pronta) {
          return jsonResponse({ ...s, error: "Complete o cadastro na prefeitura e o serviço antes de ligar a emissão." }, 422);
        }
        await admin.from("organizacao_fiscal").update({ emissao_ativa: true }).eq("organization_id", orgId);
        // As notas que esperavam a configuração saem na próxima rodada.
        await admin
          .from("notas_fiscais")
          .update({ proxima_tentativa_em: new Date().toISOString(), erro: null })
          .eq("organization_id", orgId)
          .eq("status", "pendente");
        return jsonResponse(await situacao(admin, orgId, ambiente.api, k));
      }
      return jsonResponse(s);
    }

    return jsonResponse({ error: "Ação desconhecida." }, 400);
  } catch (error) {
    if (error instanceof FalhaIndefinida) {
      return jsonResponse({ error: "Não foi possível falar com o Asaas agora. Tente de novo em instantes." }, 502);
    }
    // Nada do corpo vai para log: pode trazer senha ou certificado.
    console.error("asaas-fiscal-academia: erro inesperado", error instanceof Error ? error.name : typeof error);
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

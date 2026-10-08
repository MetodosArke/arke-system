import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { acessoArkefit } from "../_shared/acessoArkefit.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { respostaDoErroDoAuth } from "../_shared/erroDoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Todo erro de negócio volta com HTTP 200 e `{ error }` no corpo, nunca um
// status não-2xx: supabase-js `functions.invoke` só expõe o corpo em `data`
// numa resposta 2xx — num não-2xx ele descarta o corpo e troca `error` por
// um FunctionsHttpError genérico ("Edge Function returned a non-2xx status
// code"), escondendo o motivo real (ex.: o bloqueio do trigger
// prevent_remover_ultimo_gestor numa tentativa de excluir_organizacao).
const errorResponse = (mensagem: string) =>
  new Response(JSON.stringify({ error: mensagem }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Acao = "resetar_token_gateway" | "alterar_email_gestor" | "excluir_organizacao";
const ACOES_VALIDAS = new Set<Acao>(["resetar_token_gateway", "alterar_email_gestor", "excluir_organizacao"]);

type SuportePayload = {
  organization_id: string;
  acao: Acao;
  novo_email?: string; // obrigatório quando acao === "alterar_email_gestor"
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Ações de suporte do SuperAdmin sobre um tenant específico: invalidar o(s)
// token(s) de dispositivo do Gateway Local (a gestão gera o novo em Catracas),
// trocar o e-mail de login do gestor principal (auth.users — por isso exige
// Admin API/service_role, não dá para fazer via update direto do client) e
// excluir permanentemente a organização. Todas ficam na mesma função por
// reaproveitar a mesma checagem de autorização: a área da Visão Master
// (`acesso_arkefit`), que é a operação para o token e o Sócio para o resto.
servir("superadmin-suporte-tenant", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("Method not allowed");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Sessão inválida. Faça login novamente.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return errorResponse("Configuração do servidor incompleta.");
  }

  try {
    const payload: Partial<SuportePayload> = await req.json();
    const organizationId = payload.organization_id?.trim();
    const acao = payload.acao;
    const novoEmail = payload.novo_email?.trim().toLowerCase();

    if (!organizationId) return errorResponse("organization_id é obrigatório.");
    if (!acao || !ACOES_VALIDAS.has(acao)) {
      return errorResponse("Ação inválida.");
    }
    if (acao === "alterar_email_gestor" && (!novoEmail || !EMAIL_RE.test(novoEmail))) {
      return errorResponse("Novo e-mail do gestor inválido.");
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return errorResponse("Sessão inválida. Faça login novamente.");
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Os níveis da equipe ArkeFit (08/10/2026): resetar o token do Gateway é
    // da área `operacao` (o Suporte); trocar o e-mail do gestor e excluir a
    // organização são do Sócio. A pergunta vai ao banco com a sessão de quem
    // chama (`acesso_arkefit`), que exige as duas etapas.
    const area = acao === "resetar_token_gateway" ? "operacao" : "socio";
    const pode = verificada(claimsData?.claims) ? await acessoArkefit(asUser, claimsData?.claims, area) : false;
    if (pode === null) {
      console.error("superadmin-suporte-tenant: falha ao conferir o acesso");
      return errorResponse("Erro ao validar permissões.");
    }
    if (!pode) {
      return errorResponse(
        area === "operacao"
          ? "Apenas a equipe da ArkeFit com acesso à operação reseta o token do Gateway."
          : "Apenas um sócio da ArkeFit troca o e-mail do gestor ou exclui a organização.",
      );
    }

    // Lido antes da exclusão: depois do cascade o nome já não existe mais, e
    // um log que diz só "organização <uuid> excluída" não serve pra nada.
    const { data: organizacao } = await adminClient
      .from("organizations")
      .select("nome")
      .eq("id", organizationId)
      .maybeSingle();
    const nomeOrganizacao = organizacao?.nome ?? null;

    // Estas ações rodam com service_role, então auth.uid() é nulo lá no
    // banco e nenhum trigger conseguiria saber quem as disparou. Por isso o
    // registro sai daqui, onde o callerId já foi validado.
    const registrarAuditoria = async (
      acaoLog: string,
      entidade: string,
      entidadeId: string | null,
      detalhes: Record<string, unknown>,
    ) => {
      const { error } = await adminClient.rpc("registrar_auditoria", {
        _ator_user_id: callerId,
        _acao: acaoLog,
        _entidade: entidade,
        _entidade_id: entidadeId,
        _organizacao_nome: nomeOrganizacao,
        _detalhes: detalhes,
      });
      // Falha de auditoria não desfaz a ação já executada, mas não pode
      // passar silenciosa: sem este log ninguém descobre depois quem agiu.
      if (error) console.error("Falha ao registrar auditoria", acaoLog, resumoDoErro(error));
    };

    if (acao === "resetar_token_gateway") {
      const { data: qtd, error: resetError } = await adminClient.rpc("superadmin_resetar_tokens_gateway", {
        _organization_id: organizationId,
      });
      if (resetError) {
        console.error("Error resetting gateway tokens", resumoDoErro(resetError));
        return errorResponse("Erro ao resetar o token do gateway.");
      }
      await registrarAuditoria("catraca.token_resetado", "organizacao_catracas", organizationId, {
        catracas_resetadas: qtd ?? 0,
      });
      return jsonResponse({ success: true, catracas_resetadas: qtd ?? 0 });
    }

    if (acao === "excluir_organizacao") {
      // Exclusão direta é só para homologação (trial), que não tem contrato
      // nem cobrança. Academia com contrato sai pelo encerramento: aviso de
      // 30 dias, cobranças canceladas no Asaas, exportação e eliminação na
      // ordem certa (ver encerramento-organizacao). Um DELETE aqui deixaria a
      // mensalidade B2B cobrando e apagaria o registro fiscal da ArkeFit.
      // A outra exceção é a organização que nunca virou cliente: sem contrato
      // aceito, sem aluno, sem cobrança e sem conta de recebimento — como o
      // painel que sobra de um convite que falhou no meio.
      const { data: alvo } = await adminClient.from("organizations").select("status").eq("id", organizationId).maybeSingle();
      if (alvo && alvo.status !== "trial") {
        const { data: nuncaUsada, error: nuncaUsadaError } = await adminClient.rpc("organizacao_nunca_usada", {
          _organization_id: organizationId,
        });
        if (nuncaUsadaError) {
          console.error("Error checking organizacao_nunca_usada", nuncaUsadaError.code);
          return errorResponse("Erro ao conferir se a organização já foi usada.");
        }
        if (!nuncaUsada) {
          return jsonResponse(
            { error: "Academia com contrato sai pelo encerramento (aviso de 30 dias), na ficha da organização." },
            409,
          );
        }
      }
      // organizations é a "raiz" do multitenant: toda tabela filha
      // (alunos, treinos, dietas, checkins, agendamentos, cobrancas_b2b,
      // organization_members etc.) referencia organization_id com
      // "on delete cascade" desde a fundação do schema — apagar a linha
      // aqui já limpa membros, dados e vínculos em cascata no banco. Não
      // apaga as contas em auth.users: o mesmo gestor pode ser dono de
      // outra organização (ver criar-organizacao-superadmin), então a
      // conta em si não pertence a uma organização específica.
      const { data: deletada, error: deleteError } = await adminClient
        .from("organizations")
        .delete()
        .eq("id", organizationId)
        .select("id")
        .maybeSingle();
      if (deleteError) {
        console.error("Error deleting organization", resumoDoErro(deleteError));
        // A recusa dos nossos gatilhos (a cobrança viva de um aluno, por
        // exemplo) diz o que fazer, e vai para a tela. A mensagem crua do
        // banco, não (frente D, 07/10/2026).
        if (deleteError.code === "P0001" || deleteError.code === "23001") return errorResponse(deleteError.message);
        return errorResponse("Erro ao excluir a organização.");
      }
      if (!deletada) {
        return errorResponse("Organização não encontrada.");
      }
      await registrarAuditoria("organizacao.excluida", "organizations", organizationId, {
        cascade: "alunos, equipe, treinos, dietas, check-ins, agendamentos e cobranças",
        motivo: alvo?.status === "trial" ? "homologação" : "nunca usada",
      });
      return jsonResponse({ success: true });
    }

    // alterar_email_gestor
    const { data: gestorMembership, error: gestorError } = await adminClient
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "gestor")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (gestorError) {
      console.error("Error loading gestor", resumoDoErro(gestorError));
      return errorResponse("Erro ao localizar o gestor da organização.");
    }
    if (!gestorMembership) {
      return errorResponse("Nenhum gestor ativo encontrado nesta organização.");
    }

    const { error: emailError } = await adminClient.auth.admin.updateUserById(gestorMembership.user_id, {
      email: novoEmail,
      email_confirm: true,
    });
    if (emailError) {
      console.error("Error updating gestor email", resumoDoErro(emailError));
      // A mensagem do Auth não vai para a tela (frente D, 07/10/2026).
      return errorResponse(respostaDoErroDoAuth(emailError, "Não foi possível trocar o e-mail do gestor. Tente de novo.").mensagem);
    }

    // Guarda o user_id do gestor e que o login mudou, sem o e-mail (nem o novo
    // nem o antigo): a trilha não tem prazo, e o e-mail já mora na conta. O
    // banco tira e-mail de todo registro desta ação, por qualquer caminho
    // (20261397010000).
    await registrarAuditoria("gestor.email_alterado", "auth.users", gestorMembership.user_id, {
      mudou: "e-mail de login",
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in superadmin-suporte-tenant", resumoDoErro(error));
    return errorResponse("Erro inesperado ao executar a ação de suporte.");
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { alvoSoNaAcademia, MENSAGEM_OUTRA_ACADEMIA } from "../_shared/alvoNaAcademia.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { respostaDoErroDoAuth } from "../_shared/erroDoAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Papel = "gestor" | "professor" | "nutricionista" | "recepcao";
const PAPEIS_VALIDOS = new Set<Papel>(["gestor", "professor", "nutricionista", "recepcao"]);

type EditarMembroPayload = {
  user_id: string;
  organization_id: string;
  full_name?: string;
  email?: string;
  role?: Papel;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Edita nome, e-mail e/ou papel de um membro de equipe já cadastrado.
// E-mail vive em auth.users (não em profiles), então essa troca exige a
// Admin API com service_role — por isso é uma Edge Function, não um
// update direto do client. Nome e papel também passam por aqui para
// manter a mesma checagem de autorização (gestor da própria org, ou
// admin_arke) num só lugar.
servir("editar-membro-equipe", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<EditarMembroPayload> = await req.json();
    const targetUserId = payload.user_id?.trim();
    const organizationId = payload.organization_id?.trim();
    const fullName = payload.full_name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const role = payload.role;

    if (!targetUserId) {
      return jsonResponse({ error: "user_id é obrigatório." }, 400);
    }
    if (!organizationId) {
      return jsonResponse({ error: "organization_id é obrigatório." }, 400);
    }
    if (email && !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (role && !PAPEIS_VALIDOS.has(role)) {
      return jsonResponse({ error: "Papel inválido. Use gestor, professor, nutricionista ou recepcao." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", resumoDoErro(callerRolesError));
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsAdminArke = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "admin_arke");

    // Um mesmo user_id pode ter vínculos ativos em mais de uma organização
    // (ex.: personal que também atende como recepção em outra unidade) —
    // por isso a busca do membro-alvo é sempre escopada por organization_id
    // (enviado pelo client, que já opera dentro de uma organização), nunca
    // só por user_id+status (isso quebrava com "cannot coerce ... single
    // JSON object" quando havia mais de uma linha ativa).
    let autorizado = callerIsAdminArke;
    if (!autorizado) {
      const { data: callerMembership, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", callerId)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle();
      if (callerMembershipError) {
        console.error("Error loading caller membership", resumoDoErro(callerMembershipError));
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      autorizado = callerMembership?.role === "gestor";
    }
    if (!autorizado) {
      return jsonResponse({ error: "Apenas o gestor da organização pode editar membros da equipe." }, 403);
    }

    const { data: targetMembership, error: targetMembershipError } = await adminClient
      .from("organization_members")
      .select("id, organization_id, role")
      .eq("user_id", targetUserId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (targetMembershipError) {
      console.error("Error loading target membership", resumoDoErro(targetMembershipError));
      return jsonResponse({ error: "Erro ao validar o membro." }, 500);
    }
    if (!targetMembership) {
      return jsonResponse({ error: "Membro não encontrado nesta organização." }, 404);
    }

    // Esta função é da equipe. Com um aluno como alvo, a gestão trocaria o
    // e-mail de login dele pelo próprio e, pela redefinição de senha, entraria
    // como o aluno: leria a dieta e a anamnese do Método e autorizaria IA e
    // biometria no nome dele (auditoria de 05/10/2026).
    if (!PAPEIS_VALIDOS.has(targetMembership.role as Papel)) {
      return jsonResponse({ error: "Esta tela edita só a equipe. Os dados de login do aluno são dele." }, 403);
    }

    // E-mail de login e nome são da CONTA da pessoa, que pode ter vínculo em
    // outra academia: trocar o e-mail e pedir a redefinição de senha nele
    // daria a conta inteira a quem trocou. O gestor só troca de quem está
    // apenas nesta academia; o resto fica com a ArkeFit ou com a pessoa.
    if ((email || fullName) && !callerIsAdminArke && !(await alvoSoNaAcademia(adminClient, targetUserId, organizationId))) {
      return jsonResponse({ error: MENSAGEM_OUTRA_ACADEMIA }, 403);
    }

    // Trocar o e-mail de login entrega a conta a quem tem o e-mail novo: a
    // gestão confirma com as duas etapas (decisão de 04/10/2026). A ArkeFit já
    // chega verificada.
    if (email && !callerIsAdminArke && !verificada(claimsData?.claims)) {
      return jsonResponse({ error: "Trocar o e-mail de login pede a verificação em duas etapas." }, 403);
    }

    // Cada troca fica na auditoria: quem trocou (`ator_user_id`), de quem
    // (`entidade_id`), o que mudou e se foi a ArkeFit — sem o e-mail e sem o
    // nome, nem o novo nem o antigo: a trilha não tem prazo, e os dois já
    // moram na conta; as outras ações da trilha também guardam a pessoa só
    // pelo id. Esta função roda com a service role, então nenhum gatilho
    // saberia quem agiu: o registro sai daqui. Falha de auditoria não desfaz
    // a troca já feita, mas não passa em silêncio.
    let nomeOrganizacao: string | null | undefined;
    const registrarAuditoria = async (acao: string, detalhes: Record<string, unknown>) => {
      if (nomeOrganizacao === undefined) {
        const { data: organizacao } = await adminClient
          .from("organizations")
          .select("nome")
          .eq("id", organizationId)
          .maybeSingle();
        nomeOrganizacao = organizacao?.nome ?? null;
      }
      const { error: auditoriaError } = await adminClient.rpc("registrar_auditoria", {
        _ator_user_id: callerId,
        _acao: acao,
        _entidade: "auth.users",
        _entidade_id: targetUserId,
        _organizacao_nome: nomeOrganizacao,
        _detalhes: detalhes,
      });
      if (auditoriaError) console.error("Falha ao registrar auditoria", acao, resumoDoErro(auditoriaError));
    };

    if (email) {
      const { error: emailError } = await adminClient.auth.admin.updateUserById(targetUserId, {
        email,
        email_confirm: true,
      });
      if (emailError) {
        console.error("Error updating email", resumoDoErro(emailError));
        // A mensagem do Auth não vai para a tela: pode trazer o e-mail
        // digitado e descreve o servidor (frente D, 07/10/2026).
        const r = respostaDoErroDoAuth(emailError, "Não foi possível trocar o e-mail. Tente de novo.");
        return jsonResponse({ error: r.mensagem }, r.status);
      }

      // O banco também tira e-mail de todo registro de troca de e-mail, por
      // qualquer caminho (20261401010000).
      await registrarAuditoria("equipe.email_alterado", {
        mudou: "e-mail de login",
        papel_alvo: targetMembership.role,
        pela_arkefit: callerIsAdminArke,
      });
    }

    if (fullName) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ full_name: fullName })
        .eq("user_id", targetUserId);
      if (profileError) {
        console.error("Error updating profile", resumoDoErro(profileError));
        return jsonResponse({ error: "Erro ao atualizar o nome." }, 500);
      }
      await registrarAuditoria("equipe.nome_alterado", {
        mudou: "nome",
        papel_alvo: targetMembership.role,
        pela_arkefit: callerIsAdminArke,
      });
    }

    // O mesmo papel de antes não é troca: nem grava, nem vai para a trilha.
    if (role && role !== targetMembership.role) {
      const { error: roleError } = await adminClient
        .from("organization_members")
        .update({ role })
        .eq("id", targetMembership.id);
      if (roleError) {
        console.error("Error updating role", resumoDoErro(roleError));
        return jsonResponse({ error: "Erro ao atualizar o papel." }, 500);
      }
      // `{de, para}` é o formato que a Auditoria da Visão Master lê como
      // "papel: professor → gestor".
      await registrarAuditoria("equipe.papel_alterado", {
        papel: { de: targetMembership.role, para: role },
        pela_arkefit: callerIsAdminArke,
      });
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("Unexpected error in editar-membro-equipe", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao editar o membro." }, 500);
  }
});

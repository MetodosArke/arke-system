import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { emailPainelPronto, type Especialidade } from "./email.ts";
import { servir } from "../_shared/servir.ts";

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

const ESPECIALIDADES_VALIDAS = new Set<Especialidade>(["professor", "nutricionista"]);

type Acao = "criar" | "responsavel" | "reenviar";

type Payload = {
  // Sem ação: com organization_id é "responsavel", sem ele é "criar" (a
  // chamada antiga da tela mandava só os dados da pessoa).
  acao?: Acao;
  organization_id?: string;
  email?: string;
  full_name?: string;
  telefone?: string;
  especialidade?: Especialidade;
  // O nome do negócio, quando não é o da pessoa. Sem ele, o painel leva o nome dela.
  nome_painel?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const slugify = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

class Recusa extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

// O painel do profissional autônomo: uma organização de uma pessoa só (tipo =
// profissional_autonomo), em que ela é a gestora. Só o Super Admin, com as duas
// etapas. Três ações:
//
// - criar: o painel novo e o responsável;
// - responsavel: põe o responsável num painel que não tem, ou troca o que
//   nunca entrou (e-mail errado no convite);
// - reenviar: manda de novo o link de criar a senha a quem nunca entrou.
//
// Quem já tem conta no ArkeFit (aluno de uma academia, por exemplo) é ligado
// ao painel e recebe um aviso: o Auth não convida quem existe, e até
// 03/10/2026 isso derrubava o convite e deixava a organização vazia para trás.
servir("convidar-profissional-autonomo", async (req: Request) => {
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
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Payload = await req.json().catch(() => ({}));
    const orgPedida = typeof payload.organization_id === "string" && UUID_RE.test(payload.organization_id)
      ? payload.organization_id
      : null;
    const acao: Acao = payload.acao ?? (orgPedida ? "responsavel" : "criar");
    if (!["criar", "responsavel", "reenviar"].includes(acao)) {
      return jsonResponse({ error: "Ação inválida." }, 400);
    }
    if (acao !== "criar" && !orgPedida) {
      return jsonResponse({ error: "Informe o painel." }, 400);
    }

    const email = payload.email?.trim().toLowerCase() ?? "";
    const fullName = payload.full_name?.trim() ?? "";
    const telefone = payload.telefone?.trim() || null;
    if (acao !== "reenviar") {
      if (!EMAIL_RE.test(email)) return jsonResponse({ error: "E-mail inválido." }, 400);
      if (!fullName) return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    }
    if (acao === "criar" && (!payload.especialidade || !ESPECIALIDADES_VALIDAS.has(payload.especialidade))) {
      return jsonResponse({ error: "Selecione a especialidade: Personal Trainer ou Nutricionista." }, 400);
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

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRoles, error: callerRolesError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsSuperadmin = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "superadmin");
    if (!callerIsSuperadmin) {
      return jsonResponse({ error: "Apenas o Super Admin ArkeFit pode cuidar dos profissionais autônomos." }, 403);
    }

    const auditar = async (acaoLog: string, orgId: string, painel: string, detalhes: Record<string, unknown>) => {
      const { error } = await admin.rpc("registrar_auditoria", {
        _ator_user_id: callerId,
        _acao: acaoLog,
        _entidade: "organizations",
        _entidade_id: orgId,
        _organizacao_nome: painel,
        _detalhes: detalhes,
      });
      if (error) console.error("Falha ao registrar auditoria", acaoLog, error.code);
    };

    if (acao === "criar") {
      const especialidade = payload.especialidade!;
      const painel = payload.nome_painel?.trim() || fullName;
      const conta = await contaPorEmail(admin, email);
      if (conta) await recusarSeJaResponsavel(admin, conta.user_id, null);

      const slug = `${slugify(painel) || "profissional"}-${crypto.randomUUID().slice(0, 8)}`;
      const { data: organizacao, error: orgError } = await admin
        .from("organizations")
        .insert({
          nome: painel,
          slug,
          tipo: "profissional_autonomo",
          plano_b2b: "autonomo",
          especialidade_profissional: especialidade,
          // Plano B2B vale desde o primeiro dia; trial é ferramenta de teste que
          // o Super Admin atribui à parte, na Visão Master.
          status: "ativo",
        })
        .select("id")
        .single();
      if (orgError || !organizacao) {
        console.error("Error creating organization", orgError?.code);
        return jsonResponse({ error: "Erro ao criar o painel do profissional." }, 500);
      }
      const organizationId = organizacao.id as string;

      try {
        const r = await ligarResponsavel(admin, {
          organizationId, conta, email, fullName, telefone, painel, especialidade, siteUrl,
        });
        await auditar("profissional.convidado", organizationId, painel, {
          especialidade,
          conta_existente: !!conta,
          aviso_enviado: r.aviso_enviado,
        });
        return jsonResponse({ user_id: r.user_id, organization_id: organizationId, conta_existente: !!conta, aviso: r.aviso });
      } catch (erro) {
        // Nada fica pela metade: o painel sai junto. O await é de propósito —
        // a consulta do PostgREST não é uma Promise e não tem .catch, e foi
        // isso que deixou organizações vazias para trás até 03/10/2026.
        const { error: rbError } = await admin.from("organizations").delete().eq("id", organizationId);
        if (rbError) console.error("rollback organization", rbError.code);
        throw erro;
      }
    }

    // As duas outras ações partem de um painel existente.
    const { data: org, error: orgLeitura } = await admin
      .from("organizations")
      .select("id, nome, tipo, especialidade_profissional")
      .eq("id", orgPedida!)
      .maybeSingle();
    if (orgLeitura) {
      console.error("Error loading organization", orgLeitura.code);
      return jsonResponse({ error: "Erro ao ler o painel." }, 500);
    }
    if (!org || org.tipo !== "profissional_autonomo") {
      return jsonResponse({ error: "Painel de profissional não encontrado." }, 404);
    }
    const especialidade = (org.especialidade_profissional ?? "professor") as Especialidade;

    const { data: gestores, error: gestoresError } = await admin
      .from("organization_members")
      .select("user_id, created_at")
      .eq("organization_id", org.id)
      .eq("role", "gestor")
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (gestoresError) {
      console.error("Error loading gestores", gestoresError.code);
      return jsonResponse({ error: "Erro ao ler o responsável do painel." }, 500);
    }
    const atual = gestores?.[0]?.user_id ?? null;
    const atualUsuario = atual ? (await admin.auth.admin.getUserById(atual)).data.user : null;

    if (acao === "reenviar") {
      if (!atual || !atualUsuario?.email) return jsonResponse({ error: "O painel não tem responsável." }, 409);
      if (atualUsuario.last_sign_in_at) {
        return jsonResponse(
          { error: "O responsável já entra no painel. Se esqueceu a senha, é pelo “Esqueci minha senha” da tela de entrar." },
          409
        );
      }
      const { data: perfil } = await admin.from("profiles").select("full_name").eq("user_id", atual).maybeSingle();
      const enviado = await enviarAviso(admin, {
        email: atualUsuario.email,
        nome: perfil?.full_name ?? "",
        painel: org.nome,
        especialidade,
        siteUrl,
        criarSenha: true,
      });
      if (!enviado.ok) return jsonResponse({ error: enviado.erro }, 502);
      await auditar("profissional.acesso_reenviado", org.id, org.nome, {});
      return jsonResponse({ ok: true });
    }

    // responsavel: o painel sem responsável recebe um; o que tem um que nunca
    // entrou (e-mail errado no convite) troca. Quem já entra no painel não é
    // trocado por aqui: aí o caminho é corrigir o e-mail de login dele.
    if (atual && atualUsuario?.last_sign_in_at) {
      return jsonResponse(
        { error: "O responsável atual já entra no painel. Para corrigir o e-mail de login dele, use “Alterar e-mail de login”." },
        409
      );
    }
    const conta = await contaPorEmail(admin, email);
    if (conta && conta.user_id === atual) {
      return jsonResponse({ error: "Essa pessoa já é a responsável pelo painel. Para mandar o link de novo, use “Reenviar acesso”." }, 409);
    }
    if (conta) await recusarSeJaResponsavel(admin, conta.user_id, org.id);

    const r = await ligarResponsavel(admin, {
      organizationId: org.id, conta, email, fullName, telefone, painel: org.nome, especialidade, siteUrl,
    });
    // O novo responsável entra antes de o anterior sair: a organização nunca
    // fica sem gestor (prevent_remover_ultimo_gestor não deixaria).
    if (atual) {
      const { error: saiuError } = await admin
        .from("organization_members")
        .update({ status: "inactive" })
        .eq("organization_id", org.id)
        .eq("user_id", atual);
      if (saiuError) console.error("Error inactivating previous gestor", saiuError.code);
    }
    await auditar("profissional.responsavel_definido", org.id, org.nome, {
      conta_existente: !!conta,
      substituiu_responsavel: !!atual,
      aviso_enviado: r.aviso_enviado,
    });
    return jsonResponse({ user_id: r.user_id, organization_id: org.id, conta_existente: !!conta, aviso: r.aviso });
  } catch (error) {
    if (error instanceof Recusa) return jsonResponse({ error: error.message }, error.status);
    console.error("Unexpected error in convidar-profissional-autonomo", error instanceof Error ? error.message : "desconhecido");
    return jsonResponse({ error: "Erro inesperado ao cuidar do profissional." }, 500);
  }
});

type Conta = { user_id: string; ultimo_acesso: string | null };

async function contaPorEmail(admin: SupabaseClient, email: string): Promise<Conta | null> {
  const { data, error } = await admin.rpc("conta_por_email", { _email: email });
  if (error) {
    console.error("conta_por_email", error.code);
    throw new Recusa(500, "Erro ao conferir o e-mail.");
  }
  return ((data ?? []) as Conta[])[0] ?? null;
}

// Uma pessoa, um painel de profissional: o segundo era o defeito que deixava
// "Arke" e "Arke_Jean" um ao lado do outro.
async function recusarSeJaResponsavel(admin: SupabaseClient, userId: string, exceto: string | null) {
  const { data: vinculos, error } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "gestor")
    .eq("status", "active");
  if (error) throw new Recusa(500, "Erro ao conferir os painéis da pessoa.");
  const ids = (vinculos ?? []).map((v) => v.organization_id as string).filter((id) => id !== exceto);
  if (!ids.length) return;
  const { data: paineis } = await admin
    .from("organizations")
    .select("nome")
    .in("id", ids)
    .eq("tipo", "profissional_autonomo")
    .limit(1);
  if (paineis?.length) {
    throw new Recusa(409, `Esse e-mail já é o responsável pelo painel “${paineis[0].nome}”. Abra-o na lista para editar.`);
  }
}

async function ligarResponsavel(
  admin: SupabaseClient,
  o: {
    organizationId: string;
    conta: Conta | null;
    email: string;
    fullName: string;
    telefone: string | null;
    painel: string;
    especialidade: Especialidade;
    siteUrl: string;
  }
): Promise<{ user_id: string; aviso_enviado: boolean; aviso: string | null }> {
  if (o.conta) {
    const userId = o.conta.user_id;
    const { data: vinculo } = await admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", o.organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (vinculo && vinculo.role !== "gestor") {
      throw new Recusa(409, "Essa pessoa já está no painel com outro papel (aluno ou parceiro).");
    }
    // O perfil é da pessoa: completa o que falta, sem trocar o que ela já usa.
    const { data: perfil } = await admin.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle();
    if (!perfil) {
      const { error } = await admin
        .from("profiles")
        .upsert({ user_id: userId, full_name: o.fullName, phone: o.telefone, status: "active" }, { onConflict: "user_id" });
      if (error) throw new Recusa(500, "Erro ao preparar o perfil do profissional.");
    } else if (!perfil.full_name?.trim() || (!perfil.phone && o.telefone)) {
      const { error } = await admin
        .from("profiles")
        .update({ full_name: perfil.full_name?.trim() || o.fullName, phone: perfil.phone || o.telefone })
        .eq("user_id", userId);
      if (error) console.error("Error completing profile", error.code);
    }
    const { error: membroError } = await admin
      .from("organization_members")
      .upsert({ organization_id: o.organizationId, user_id: userId, role: "gestor", status: "active" }, { onConflict: "organization_id,user_id" });
    if (membroError) {
      console.error("Error linking existing account", membroError.code);
      throw new Recusa(500, "Erro ao ligar a conta ao painel.");
    }
    const enviado = await enviarAviso(admin, {
      email: o.email,
      nome: perfil?.full_name?.trim() || o.fullName,
      painel: o.painel,
      especialidade: o.especialidade,
      siteUrl: o.siteUrl,
      criarSenha: !o.conta.ultimo_acesso,
    });
    return {
      user_id: userId,
      aviso_enviado: enviado.ok,
      aviso: enviado.ok ? null : "O painel está pronto, mas o e-mail de aviso não saiu. Mande o link de ativação pela ficha do profissional.",
    };
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(o.email, {
    data: { full_name: o.fullName },
    redirectTo: `${o.siteUrl}/#/auth/definir-senha`,
  });
  if (inviteError || !invited.user) {
    console.error("Error inviting user", inviteError?.code ?? inviteError?.status);
    throw new Recusa(400, "Não foi possível enviar o convite para esse e-mail.");
  }
  const userId = invited.user.id;
  const desfazer = async () => {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error("rollback deleteUser", error.status);
  };
  const { error: perfilError } = await admin
    .from("profiles")
    .upsert({ user_id: userId, full_name: o.fullName, phone: o.telefone, status: "active" }, { onConflict: "user_id" });
  if (perfilError) {
    await desfazer();
    throw new Recusa(500, "Erro ao preparar o perfil do profissional.");
  }
  const { error: membroError } = await admin
    .from("organization_members")
    .insert({ organization_id: o.organizationId, user_id: userId, role: "gestor", status: "active" });
  if (membroError) {
    await desfazer();
    throw new Recusa(500, "Erro ao vincular o profissional ao painel.");
  }
  return { user_id: userId, aviso_enviado: true, aviso: null };
}

async function enviarAviso(
  admin: SupabaseClient,
  o: { email: string; nome: string; painel: string; especialidade: Especialidade; siteUrl: string; criarSenha: boolean }
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, erro: "O envio de e-mail não está configurado." };

  let link = `${o.siteUrl}/#/auth/login`;
  if (o.criarSenha) {
    // Mesmo caminho do link de ativação da ficha do aluno: a tela de criar a
    // senha, sem passar pela de recuperação.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: o.email,
      options: { redirectTo: `${o.siteUrl}/#/auth/definir-senha` },
    });
    if (error || !data?.properties?.action_link) {
      console.error("Error generating link", error?.status);
      return { ok: false, erro: "Não foi possível gerar o link de criar a senha." };
    }
    link = data.properties.action_link;
  }

  const { data: textos } = await admin.from("plataforma_textos").select("valor").eq("chave", "suporte_email").maybeSingle();
  const responderPara = textos?.valor?.trim() || null;
  const de = Deno.env.get("EMAIL_IMPLANTACAO_FROM") ?? "ArkeFit <implantacao@arkefit.com.br>";
  const conteudo = emailPainelPronto({
    nome: o.nome,
    painel: o.painel,
    especialidade: o.especialidade,
    link,
    criarSenha: o.criarSenha,
  });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: de,
        to: [o.email],
        ...(responderPara ? { reply_to: responderPara } : {}),
        subject: conteudo.assunto,
        html: conteudo.html,
        text: conteudo.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error("Resend", r.status);
      return { ok: false, erro: "O e-mail não saiu. Tente de novo em alguns minutos." };
    }
    return { ok: true };
  } catch {
    return { ok: false, erro: "O e-mail não saiu. Tente de novo em alguns minutos." };
  }
}

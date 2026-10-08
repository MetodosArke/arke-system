import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { acessoArkefit } from "../_shared/acessoArkefit.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { emailJaCadastrado, respostaDoErroDoAuth } from "../_shared/erroDoAuth.ts";

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

type TipoOrg = "academia" | "studio";
const TIPOS_VALIDOS = new Set<TipoOrg>(["academia", "studio"]);
// Os planos à venda (tabela de 01/10/2026). O Starter saiu de venda.
const PLANOS_VALIDOS = new Set(["growth", "enterprise", "redes", "custom"]);
const STATUS_VALIDOS = new Set(["trial", "ativo"]);

type CriarOrganizacaoPayload = {
  nome: string;
  slug: string;
  tipo: TipoOrg;
  gestor_email: string;
  gestor_nome: string;
  plano_b2b: "growth" | "enterprise" | "redes" | "custom";
  status: "trial" | "ativo";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugify = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

// Onboarding Assistido de Tenants: SuperAdmin cadastra uma nova academia
// ou studio. O gestor principal pode ser um e-mail totalmente novo (recebe
// o convite padrão de primeiro acesso, com senha temporária nunca
// exposta) ou um e-mail que já tem conta no Supabase Auth (ex.: já é
// gestor de outra organização) — nesse caso a conta existente é vinculada
// à organização nova como gestor PENDENTE, sem tentar convidar de novo (o
// que sempre falharia com "already registered"), e recebe o link de definir
// a senha; a gestão só vale depois que a pessoa entra por ele (desde
// 06/10/2026, ver o comentário do vínculo). Se o envio do e-mail (em
// qualquer um dos dois casos) falhar por qualquer motivo, a organização e
// o vínculo do gestor são criados normalmente — só a UI é avisada de que
// o e-mail não saiu, para o SuperAdmin repassar o acesso manualmente
// (ex.: via /superadmin, ação equivalente à de "gerar-link-ativacao").
servir("criar-organizacao-superadmin", async (req: Request) => {
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
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://arkefit.com.br";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<CriarOrganizacaoPayload> = await req.json();
    const nome = payload.nome?.trim();
    const slugBruto = payload.slug?.trim();
    const tipo = payload.tipo;
    const gestorEmail = payload.gestor_email?.trim().toLowerCase();
    const gestorNome = payload.gestor_nome?.trim();
    const planoB2b = payload.plano_b2b;
    const status = payload.status;

    if (!nome) return jsonResponse({ error: "Nome da unidade é obrigatório." }, 400);
    if (!tipo || !TIPOS_VALIDOS.has(tipo)) {
      return jsonResponse({ error: "Tipo inválido. Use academia ou studio." }, 400);
    }
    if (!gestorEmail || !EMAIL_RE.test(gestorEmail)) {
      return jsonResponse({ error: "E-mail do gestor inválido." }, 400);
    }
    if (!gestorNome) return jsonResponse({ error: "Nome do gestor é obrigatório." }, 400);
    if (!planoB2b || !PLANOS_VALIDOS.has(planoB2b)) {
      return jsonResponse({ error: "Plano inválido." }, 400);
    }
    if (!status || !STATUS_VALIDOS.has(status)) {
      return jsonResponse({ error: "Status inválido. Use trial ou ativo." }, 400);
    }

    const slugNormalizado = slugify(slugBruto || nome);
    if (!slugNormalizado) {
      return jsonResponse({ error: "Slug inválido." }, 400);
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

    // Os níveis da equipe ArkeFit (08/10/2026): cadastrar a academia é da área
    // `cadastro` (o Comercial e o Sócio). O trial é homologação, e dar trial é
    // só do Sócio: o Comercial cria a academia como `ativo`. A pergunta vai ao
    // banco com a sessão de quem chama (`acesso_arkefit`), que exige as duas
    // etapas. A organização é gravada pela service role, que os gatilhos não
    // conferem: a regra mora aqui.
    const podeCadastrar = verificada(claimsData?.claims) ? await acessoArkefit(asUser, claimsData?.claims, "cadastro") : false;
    if (podeCadastrar === null) {
      console.error("criar-organizacao-superadmin: falha ao conferir o acesso");
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    if (!podeCadastrar) {
      return jsonResponse({ error: "Apenas a equipe da ArkeFit com acesso ao cadastro cadastra organizações." }, 403);
    }
    if (status === "trial") {
      const socio = await acessoArkefit(asUser, claimsData?.claims, "socio");
      if (socio === null) {
        console.error("criar-organizacao-superadmin: falha ao conferir o acesso");
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      if (!socio) {
        return jsonResponse({ error: "O trial é homologação e só um sócio da ArkeFit o dá. Cadastre a academia como ativa." }, 403);
      }
    }

    const { data: organizacao, error: orgError } = await adminClient
      .from("organizations")
      .insert({
        nome,
        slug: slugNormalizado,
        tipo,
        plano_b2b: planoB2b,
        status,
      })
      .select("id")
      .single();
    if (orgError || !organizacao) {
      console.error("Error creating organization", resumoDoErro(orgError));
      const slugDuplicado = orgError?.code === "23505";
      return jsonResponse(
        { error: slugDuplicado ? "Esse slug já está em uso por outra organização." : "Erro ao criar a organização." },
        slugDuplicado ? 409 : 500
      );
    }
    const organizationId = organizacao.id as string;

    const rollbackOrganizacao = async () => {
      // A consulta do PostgREST não é uma Promise com .catch: o erro vem no
      // resultado. O .catch daqui quebrava o próprio desfazer.
      const { error } = await adminClient.from("organizations").delete().eq("id", organizationId);
      if (error) console.error("rollback organization", error.code);
    };

    // ---------------------------------------------------------------
    // Resolve o gestor: conta nova (convite) ou conta já existente
    // (vincula à organização nova). Qualquer problema no ENVIO do
    // e-mail — em qualquer um dos dois caminhos — não derruba a criação
    // da organização; só fica registrado em `aviso` para a UI mostrar.
    // ---------------------------------------------------------------
    let gestorUserId: string | null = null;
    let gestorJaExistia = false;
    let aviso: string | null = null;

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(gestorEmail, {
      data: { full_name: gestorNome },
      redirectTo: `${siteUrl}/#/auth/definir-senha`,
    });

    if (!inviteError && invited?.user) {
      gestorUserId = invited.user.id;
    } else if (emailJaCadastrado(inviteError)) {
      // Requisito 1: e-mail já tem conta — não tenta inviteUserByEmail de
      // novo (sempre falharia), só localiza o user_id e vincula.
      gestorJaExistia = true;
      const { data: userIdExistente, error: buscaError } = await adminClient.rpc("buscar_user_id_por_email", {
        _email: gestorEmail,
      });
      if (buscaError || !userIdExistente) {
        console.error("Error looking up existing gestor by email", resumoDoErro(buscaError));
        await rollbackOrganizacao();
        return jsonResponse(
          { error: "Já existe uma conta com esse e-mail, mas não foi possível localizá-la para vincular à organização." },
          500
        );
      }
      gestorUserId = userIdExistente as string;
    } else {
      // Requisito 3 (fallback): o convite falhou por outro motivo (ex.:
      // SMTP indisponível) — cria a conta sem depender do envio de e-mail
      // (generateLink nunca envia e-mail sozinho, só gera o link/token,
      // mesmo mecanismo já usado em gerar-link-ativacao) em vez de abortar.
      console.error("Error inviting gestor, falling back to silent account creation", resumoDoErro(inviteError));
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email: gestorEmail,
        options: { data: { full_name: gestorNome }, redirectTo: `${siteUrl}/#/auth/definir-senha` },
      });
      if (linkError || !linkData?.user) {
        console.error("Error creating gestor account via generateLink fallback", resumoDoErro(linkError));
        await rollbackOrganizacao();
        // A mensagem do Auth não vai para a tela: pode trazer o e-mail
        // digitado e descreve o servidor (frente D, 07/10/2026).
        const r = respostaDoErroDoAuth(linkError ?? inviteError, "Não foi possível criar a conta do gestor. Tente de novo.");
        return jsonResponse({ error: r.mensagem }, r.status);
      }
      gestorUserId = linkData.user.id;
      aviso = "Não foi possível enviar o e-mail de convite automático.";
    }

    const rollback = async () => {
      if (!gestorJaExistia && gestorUserId) {
        await adminClient.auth.admin.deleteUser(gestorUserId).catch((e) => console.error("rollback deleteUser", resumoDoErro(e)));
      }
      await rollbackOrganizacao();
    };

    // Conta nova: prepara o perfil. Conta já existente mantém o perfil que
    // já tinha (pode já ser gestora de outra organização, com nome/avatar
    // próprios — não sobrescreve silenciosamente por causa desta org nova).
    if (!gestorJaExistia) {
      const { error: profileError } = await adminClient
        .from("profiles")
        .upsert({ user_id: gestorUserId, full_name: gestorNome, status: "active" }, { onConflict: "user_id" });
      if (profileError) {
        console.error("Error upserting profile", resumoDoErro(profileError));
        await rollback();
        return jsonResponse({ error: "Erro ao preparar o perfil do gestor." }, 500);
      }
    }

    // Conta que já existia entra na gestão PENDENTE (20261362010000). Nada
    // nela prova que o dono do e-mail é quem a criou: a matrícula pública cria
    // a conta com o e-mail já confirmado, e a senha é de quem se matriculou.
    // A gestão só vale quando a pessoa entra pelo link do e-mail e define a
    // senha ali (`ativar_gestao_pendente`); nessa hora as outras sessões da
    // conta são encerradas.
    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({
        organization_id: organizationId,
        user_id: gestorUserId,
        role: "gestor",
        status: gestorJaExistia ? "pending" : "active",
      });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError.code);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o gestor à organização." }, 500);
    }

    // O link de definir a senha vai para o e-mail da conta: só o dono do
    // e-mail ativa a gestão. Em try/catch isolado: se o envio falhar, a
    // organização e o vínculo pendente ficam, e a UI avisa.
    if (gestorJaExistia) {
      try {
        const publicClient = createClient(supabaseUrl, anonKey);
        const { error: notifyError } = await publicClient.auth.resetPasswordForEmail(gestorEmail, {
          redirectTo: `${siteUrl}/#/auth/definir-senha`,
        });
        if (notifyError) throw notifyError;
      } catch (notifyErr) {
        console.error("Error sending password link to existing gestor", notifyErr instanceof Error ? notifyErr.name : "erro");
        aviso =
          "A gestão fica pendente até a pessoa definir a senha pelo link do e-mail, e o e-mail não saiu. Peça a ela para usar “Esqueci minha senha” na tela de entrar.";
      }
    }

    return jsonResponse({
      organization_id: organizationId,
      gestor_user_id: gestorUserId,
      gestor_ja_existia: gestorJaExistia,
      gestor_pendente: gestorJaExistia,
      aviso,
    });
  } catch (error) {
    console.error("Unexpected error in criar-organizacao-superadmin", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao criar a organização." }, 500);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

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

type Papel = "aluno";
const PAPEIS_VALIDOS = new Set<Papel>(["aluno"]);
const NIVEIS_VALIDOS = new Set(["essencial", "integrado", "elite"]);

type ConvidarMembroPayload = {
  email: string;
  full_name: string;
  telefone?: string;
  cpf?: string;
  papel: Papel;
  nivel_atacado?: "essencial" | "integrado" | "elite"; // opcional — default "essencial" quando omitido
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Convida (via e-mail do Supabase Auth, sem senha temporária exposta) um
// novo aluno para a organização do gestor que chama esta função. O
// cadastro de equipe (professor, nutricionista, recepção) não passa mais
// por aqui — usa a Edge Function `cadastrar-membro-equipe`, que cria a
// conta direto, com senha temporária, sem depender de entrega de e-mail.
Deno.serve(async (req: Request) => {
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
    const payload: Partial<ConvidarMembroPayload> = await req.json();
    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.full_name?.trim();
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;
    const papel = payload.papel;
    // Nível do Método ARKE: não é obrigatório. A academia ainda pode não ter
    // decidido isso na hora do cadastro (ex.: importação em massa de alunos
    // que ainda nem aderiram ao método) — nesse caso cai no default
    // "essencial", igual o default da coluna no banco.
    const nivelAtacado = payload.nivel_atacado && NIVEIS_VALIDOS.has(payload.nivel_atacado) ? payload.nivel_atacado : "essencial";

    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (!fullName) {
      return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    }
    if (!papel || !PAPEIS_VALIDOS.has(papel)) {
      return jsonResponse({ error: "Papel inválido. Use aluno, professor, nutricionista ou recepcao." }, 400);
    }

    // Cliente com o JWT do chamador: usado só para identificar quem está
    // chamando (via getClaims). As checagens de autorização abaixo usam o
    // client de service_role para ler o estado real sem depender de RLS.
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

    const { data: callerMembership, error: callerMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", callerId)
      .eq("status", "active")
      .maybeSingle();

    if (callerMembershipError) {
      console.error("Error loading caller membership", callerMembershipError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    if (!callerMembership || callerMembership.role !== "gestor") {
      return jsonResponse(
        { error: "Apenas o gestor da organização pode cadastrar alunos ou convidar a equipe." },
        403
      );
    }
    const organizationId = callerMembership.organization_id;

    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      // Aponta direto pra tela de "defina sua senha e entre" (mesmo
      // caminho usado em gerar-link-ativacao) — sem isso, o link cai na
      // raiz do site e depende só da detecção de type=invite no index.html,
      // que fica frágil se o domínio do e-mail (redirectTo) não bater
      // exatamente com o domínio publicado.
      redirectTo: `${siteUrl}/#/auth/definir-senha`,
    });

    if (inviteError || !invited.user) {
      console.error("Error inviting user", inviteError);
      const alreadyExists = inviteError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe um usuário cadastrado com esse e-mail."
            : inviteError?.message ?? "Falha ao convidar o usuário.",
        },
        alreadyExists ? 409 : 400
      );
    }

    const newUserId = invited.user.id;

    // rollback best-effort em qualquer etapa seguinte que falhar
    const rollback = async () => {
      await adminClient.auth.admin.deleteUser(newUserId).catch((e) => console.error("rollback deleteUser", e));
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        { user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" },
        { onConflict: "user_id" }
      );
    if (profileError) {
      console.error("Error upserting profile", profileError);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: newUserId, role: papel, status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à organização." }, 500);
    }

    if (papel === "aluno") {
      const { error: alunoError } = await adminClient
        .from("alunos")
        .insert({ organization_id: organizationId, user_id: newUserId, nivel_atacado: nivelAtacado });
      if (alunoError) {
        console.error("Error inserting aluno", alunoError);
        await adminClient.from("organization_members").delete().eq("user_id", newUserId);
        await rollback();
        return jsonResponse({ error: "Erro ao criar o cadastro do aluno." }, 500);
      }
    }

    return jsonResponse({ user_id: newUserId });
  } catch (error) {
    console.error("Unexpected error in convidar-membro", error);
    return jsonResponse({ error: "Erro inesperado ao processar o convite." }, 500);
  }
});

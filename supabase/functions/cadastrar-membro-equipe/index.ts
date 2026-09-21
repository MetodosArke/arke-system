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

type Papel = "professor" | "nutricionista" | "recepcao";
const PAPEIS_VALIDOS = new Set<Papel>(["professor", "nutricionista", "recepcao"]);

type CadastrarMembroPayload = {
  email: string;
  full_name: string;
  telefone?: string;
  cpf?: string;
  papel: Papel;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validação de CPF pelo módulo 11.
 *
 * Duplicada de src/lib/cpf.ts de propósito: edge function roda em Deno e
 * não importa do bundle do app. O banco tem a mesma regra em
 * public.cpf_valido() e é ele quem garante — isto existe para o gestor ver
 * uma mensagem que dá para entender, em vez de um erro de constraint.
 */
function cpfValido(valor: string): boolean {
  const c = valor.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto >= 10 ? 0 : resto;
  };

  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

// Gera uma senha temporária aleatória (não previsível) para o cadastro
// direto do funcionário — o gestor repassa esse valor por fora (WhatsApp,
// verbal), e o próprio funcionário pode trocá-la depois via "Esqueci minha
// senha" (fluxo de recovery, que já dispara o e-mail com layout ArkeFit).
function gerarSenhaTemporaria(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 14) + "aA1!";
}

// Cadastro direto de um funcionário (professor, nutricionista ou recepção)
// pela própria academia/studio — sem passar por convite por e-mail. A conta
// já nasce com e-mail confirmado e uma senha temporária definida agora,
// para o gestor poder colocar o funcionário para trabalhar imediatamente,
// sem depender de entrega de e-mail.
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

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<CadastrarMembroPayload> = await req.json();
    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.full_name?.trim();
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;
    const papel = payload.papel;

    // CPF é opcional, mas se vier tem que ser real: é a chave de leitura
    // da catraca e a de deduplicação da base. Sem esta checagem o gestor
    // receberia o erro cru da constraint do banco.
    if (cpf && !cpfValido(cpf)) {
      return jsonResponse({ error: `CPF inválido: "${cpf}". Confira os dígitos.` }, 400);
    }

    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (!fullName) {
      return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    }
    if (!papel || !PAPEIS_VALIDOS.has(papel)) {
      return jsonResponse({ error: "Papel inválido. Use professor, nutricionista ou recepcao." }, 400);
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

    // A organização do novo membro sai do vínculo do chamador, então com
    // dois vínculos a escolha é genuinamente ambígua — diferente de
    // anonimizar/excluir, onde a organização do alvo já é conhecida. Aqui
    // vale a regra de desempate já estabelecida em escolherVinculo():
    // vínculo de gestor mais antigo. Antes, um .maybeSingle() sobre todos
    // os vínculos fazia a consulta falhar e devolver 403 a quem é gestor
    // de uma academia e aluno de outra.
    const { data: vinculosGestor, error: callerMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id, role, created_at")
      .eq("user_id", callerId)
      .eq("status", "active")
      .eq("role", "gestor")
      .order("created_at", { ascending: true })
      .limit(1);

    const callerMembership = vinculosGestor?.[0] ?? null;

    if (callerMembershipError) {
      console.error("Error loading caller membership", callerMembershipError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    if (!callerMembership || callerMembership.role !== "gestor") {
      return jsonResponse({ error: "Apenas o gestor da organização pode cadastrar a equipe." }, 403);
    }
    const organizationId = callerMembership.organization_id;

    const senhaTemporaria = gerarSenhaTemporaria();

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: senhaTemporaria,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      console.error("Error creating user", createError);
      const alreadyExists = createError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe um usuário cadastrado com esse e-mail."
            : createError?.message ?? "Falha ao cadastrar o funcionário.",
        },
        alreadyExists ? 409 : 400
      );
    }

    const newUserId = created.user.id;

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

    return jsonResponse({ user_id: newUserId, senha_temporaria: senhaTemporaria });
  } catch (error) {
    console.error("Unexpected error in cadastrar-membro-equipe", error);
    return jsonResponse({ error: "Erro inesperado ao cadastrar o funcionário." }, 500);
  }
});

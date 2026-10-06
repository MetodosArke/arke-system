import { createClient } from "npm:@supabase/supabase-js@2";
import { servir } from "../_shared/servir.ts";
import { academiaDoCadastro } from "./fluxo.ts";

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
  /** A academia escolhida na tela (a unidade do seletor do cabeçalho). */
  organization_id?: string;
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
servir("cadastrar-membro-equipe", async (req: Request) => {
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
    console.error("cadastrar-membro-equipe: configuração incompleta");
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

    // A academia do novo membro é a que a tela manda (a unidade escolhida no
    // seletor), e quem chama tem de ser gestor ativo dela. Antes valia o
    // vínculo de gestor mais antigo, e o gestor de duas unidades cadastrava
    // na unidade errada. Filtra por usuário e papel, sem .maybeSingle(): quem
    // é gestor de uma academia e aluno de outra não quebra.
    const { data: vinculosGestor, error: callerMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", callerId)
      .eq("status", "active")
      .eq("role", "gestor");
    if (callerMembershipError) {
      console.error("cadastrar-membro-equipe: falha ao ler os vínculos", callerMembershipError.code);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const escolha = academiaDoCadastro(
      payload.organization_id,
      (vinculosGestor ?? []).map((v) => v.organization_id as string),
    );
    if (!escolha.ok) return jsonResponse({ error: escolha.erro }, escolha.status);
    const organizationId = escolha.organizationId;

    const senhaTemporaria = gerarSenhaTemporaria();

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: senhaTemporaria,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      // Só o status e o código: a mensagem do Auth pode trazer o e-mail.
      console.error("cadastrar-membro-equipe: falha ao criar a conta", createError?.status, createError?.code);
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
      await adminClient.auth.admin
        .deleteUser(newUserId)
        .catch((e) => console.error("cadastrar-membro-equipe: falha ao desfazer a conta", e instanceof Error ? e.name : typeof e));
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        { user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" },
        { onConflict: "user_id" }
      );
    if (profileError) {
      console.error("cadastrar-membro-equipe: falha no perfil", profileError.code);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: newUserId, role: papel, status: "active" });
    if (membershipError) {
      console.error("cadastrar-membro-equipe: falha no vínculo", membershipError.code);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à organização." }, 500);
    }

    return jsonResponse({ user_id: newUserId, senha_temporaria: senhaTemporaria });
  } catch (error) {
    console.error("cadastrar-membro-equipe: erro inesperado", error instanceof Error ? error.name : typeof error);
    return jsonResponse({ error: "Erro inesperado ao cadastrar o funcionário." }, 500);
  }
});

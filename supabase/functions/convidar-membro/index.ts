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
// O Essencial virou o plano Free (22/09/2026): não é mais nível do Método.
const NIVEIS_VALIDOS = new Set(["integrado", "elite"]);
const SITUACOES_VALIDAS = new Set(["em_dia", "inadimplente", "pausado"]);

type ConvidarMembroPayload = {
  email: string;
  full_name: string;
  telefone?: string;
  cpf?: string;
  papel: Papel;
  nivel_atacado?: "integrado" | "elite"; // opcional — sem adesão ainda, fica null quando omitido
  // Situação do aluno na academia (plano Free). Vem da importação; sem valor, em dia.
  situacao_academia?: "em_dia" | "inadimplente" | "pausado";
  // Endereço, quando a planilha traz: a prefeitura o exige na nota fiscal.
  endereco?: { cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string };
};

/**
 * Endereço vindo da planilha: entra só o que dá para confiar. CEP que não tem
 * 8 números e UF que não são duas letras ficam de fora em vez de derrubar a
 * linha — a importação é de alunos, e o endereço completa-se depois pela
 * ficha ou pelo app. As mesmas regras de `atualizar_endereco_aluno`.
 */
function enderecoDaPlanilha(e: ConvidarMembroPayload["endereco"]) {
  if (!e) return {};
  const cep = String(e.cep ?? "").replace(/\D/g, "");
  const uf = String(e.uf ?? "").trim().toUpperCase();
  const texto = (v: unknown, max: number) => {
    const t = String(v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  return {
    cep: cep.length === 8 ? cep : null,
    logradouro: texto(e.logradouro, 150),
    endereco_numero: texto(e.numero, 20),
    complemento: texto(e.complemento, 60),
    bairro: texto(e.bairro, 80),
    cidade: texto(e.cidade, 80),
    uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validação de CPF pelo módulo 11.
 *
 * Duplicada de src/lib/cpf.ts de propósito: edge function roda em Deno e
 * não importa do bundle do app. O banco tem a mesma regra em
 * public.cpf_valido() e é ele quem garante — isto aqui existe para a
 * importação em lote recusar a linha com mensagem útil, em vez de estourar
 * um erro de constraint que ninguém na recepção sabe ler.
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
    // Nível do Método ARKE: não é obrigatório. O aluno matriculado ainda nem
    // foi apresentado ao método — isso é negociação pós-implantação. Sem
    // valor válido, fica sem nível nenhum (null) até o staff registrar a
    // adesão de verdade (é aí que o nível é escolhido).
    const nivelAtacado = payload.nivel_atacado && NIVEIS_VALIDOS.has(payload.nivel_atacado) ? payload.nivel_atacado : null;
    if (payload.situacao_academia && !SITUACOES_VALIDAS.has(payload.situacao_academia)) {
      return jsonResponse({ error: "Situação inválida. Use em dia, inadimplente ou pausado." }, 400);
    }
    const situacaoAcademia = payload.situacao_academia ?? "em_dia";

    // CPF é opcional, mas se vier tem que ser real: ele é a chave de
    // leitura da catraca e a chave de deduplicação da base. Recusar aqui
    // custa uma linha de planilha; descobrir depois custa um aluno que não
    // consegue entrar na academia.
    if (cpf && !cpfValido(cpf)) {
      return jsonResponse(
        { error: `CPF inválido: "${cpf}". Confira os dígitos na planilha.` },
        400
      );
    }

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

    // Filtra por gestor e ordena, em vez de `.maybeSingle()` sobre todos os
    // vínculos: quem é gestor de uma academia e aluno de outra tinha a
    // consulta falhando e levava 403 no próprio painel. Mesma classe de
    // defeito já corrigida no AuthContext e no parse-dieta-pdf; o
    // desempate pelo vínculo mais antigo segue a regra de escolherVinculo.
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
        { user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active", ...enderecoDaPlanilha(payload.endereco) },
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
        .insert({
          organization_id: organizationId,
          user_id: newUserId,
          nivel_atacado: nivelAtacado,
          situacao_academia: situacaoAcademia,
        });
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

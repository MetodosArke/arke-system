import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { emailMatriculaNova } from "./email.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { erroDataNascimento } from "../_shared/nascimento.ts";
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
  // A unidade em que a pessoa está na tela. Quem tem duas unidades não pode
  // cadastrar na errada; sem ela, vale o vínculo mais antigo (chamada antiga).
  organization_id?: string;
  // Da importação (decisão de 04/10/2026): o cadastro nasce sem e-mail nenhum,
  // e o aluno ativa pelo convite de primeiro acesso da academia (QR Code e
  // link), quando quiser. O convite do login sai de um orçamento único do
  // projeto (500 por hora), que serve também à recuperação de senha de todas
  // as academias: uma importação de 400 alunos gastava 80% dele de uma vez.
  sem_email?: boolean;
  // AAAA-MM-DD (decisão de 06/10/2026): diz quem é menor de idade. Obrigatória
  // no cadastro pela academia; na importação, a planilha pode não trazer, e o
  // aluno fica com idade desconhecida até informá-la no app ou na recepção.
  data_nascimento?: string;
  origem?: "importacao";
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
servir("convidar-membro", async (req: Request) => {
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
    const semEmail = payload.sem_email === true && papel === "aluno";

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

    // Data de nascimento: obrigatória no cadastro. Na importação, a data que
    // falta ou que não dá para ler fica nula (idade desconhecida), e a linha
    // segue: o aluno informa a data no app, ou a recepção na ficha.
    const nascimentoInformado = typeof payload.data_nascimento === "string" ? payload.data_nascimento.trim() : "";
    const nascimentoErro = erroDataNascimento(nascimentoInformado, hojeBrasilia());
    if (nascimentoErro && payload.origem !== "importacao") return jsonResponse({ error: nascimentoErro }, 400);
    const dataNascimento = nascimentoErro ? null : nascimentoInformado;

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

    // Quem cadastra aluno: o gestor e a recepção (decisão de 25/09/2026 — no
    // balcão, quem matricula costuma ser a recepção). A unidade vem da tela e
    // é conferida: quem chama tem de ser gestor ou recepção DAQUELA unidade,
    // o que elimina a ambiguidade de quem tem duas em vez de desempatá-la.
    // Sem unidade (chamada antiga), vale o vínculo de gestor mais antigo e,
    // na falta dele, o de recepção — nunca `.maybeSingle()` sobre todos os
    // vínculos, a armadilha do vínculo duplo.
    const orgPedida =
      typeof payload.organization_id === "string" && UUID_RE.test(payload.organization_id) ? payload.organization_id : null;
    let consulta = adminClient
      .from("organization_members")
      .select("organization_id, role, created_at")
      .eq("user_id", callerId)
      .eq("status", "active")
      .in("role", ["gestor", "recepcao"]);
    if (orgPedida) consulta = consulta.eq("organization_id", orgPedida);
    const { data: vinculosAutorizados, error: callerMembershipError } = await consulta.order("created_at", { ascending: true });

    if (callerMembershipError) {
      console.error("Error loading caller membership", callerMembershipError);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerMembership =
      (vinculosAutorizados ?? []).find((v) => v.role === "gestor") ?? (vinculosAutorizados ?? [])[0] ?? null;
    if (!callerMembership) {
      return jsonResponse({ error: "Só o gestor ou a recepção desta academia podem cadastrar alunos." }, 403);
    }
    const organizationId = callerMembership.organization_id;

    // Uma importação de 400 alunos são 400 chamadas em poucos minutos, e passa.
    // O que não passa é laço.
    const freioGeral = [
      { chave: `convite:user:${callerId}`, limite: 600, janelaSeg: 60 * 60 },
      { chave: `convite:org:${organizationId}`, limite: 1500, janelaSeg: 24 * 60 * 60 },
    ];
    if (!(await dentroDoFreio(adminClient, freioGeral))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    // Quem já tem conta no ArkeFit (aluno de outra academia, por exemplo) não
    // pode ser convidado: o Auth recusa quem existe. A conta é ligada à
    // matrícula quando o CPF digitado é o dela (decisão de 03/10/2026): é a
    // prova de que a academia conhece a pessoa. Sem isso, qualquer academia
    // que soubesse um e-mail veria o nome e o telefone de quem é dono dele.
    const { data: contas, error: contaError } = await adminClient.rpc("conta_por_email", { _email: email });
    if (contaError) {
      console.error("conta_por_email", contaError.code);
      return jsonResponse({ error: "Erro ao conferir o e-mail." }, 500);
    }
    const conta = ((contas ?? []) as { user_id: string; ultimo_acesso: string | null }[])[0];
    if (conta) {
      const userId = conta.user_id;
      const { data: perfil } = await adminClient
        .from("profiles")
        .select("full_name, cpf, phone, cep")
        .eq("user_id", userId)
        .maybeSingle();
      // Primeiro o que esta academia já sabe (a equipe e os alunos dela); o
      // CPF vem depois, porque é ele que separa uma pessoa de outra.
      const { data: vinculo } = await adminClient
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (vinculo && vinculo.role !== "aluno") {
        return jsonResponse({ error: "Essa pessoa já está na equipe desta academia." }, 409);
      }
      const { data: jaAluno } = await adminClient
        .from("alunos")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (jaAluno) return jsonResponse({ error: "Essa pessoa já é aluna desta academia." }, 409);

      // O CPF é a prova de que a academia conhece a pessoa, e por isso não
      // pode ser achado por tentativa: o freio vem antes da comparação, e
      // conta toda tentativa sobre conta que já existe.
      const freioConta = [
        { chave: `convite:conta:user:${callerId}`, limite: 20, janelaSeg: 60 * 60 },
        { chave: `convite:conta:org:${organizationId}`, limite: 50, janelaSeg: 24 * 60 * 60 },
      ];
      if (!(await dentroDoFreio(adminClient, freioConta))) {
        return jsonResponse(
          { error: "Muitos cadastros de quem já tem conta no ArkeFit hoje. Tente amanhã ou fale com a ArkeFit." },
          429
        );
      }

      const cpfDigitado = (cpf ?? "").replace(/\D/g, "");
      const cpfDaConta = (perfil?.cpf ?? "").replace(/\D/g, "");
      if (!cpfDigitado || !cpfDaConta || cpfDigitado !== cpfDaConta) {
        return jsonResponse(
          {
            error:
              "Esse e-mail já tem conta no ArkeFit, e o CPF não confere com o dela. Confira o e-mail e o CPF; se estiverem certos, fale com a ArkeFit.",
          },
          409
        );
      }

      // O perfil é da pessoa: completa só o que falta, sem trocar o que ela usa.
      const completar: Record<string, unknown> = {};
      if (!perfil?.phone && telefone) completar.phone = telefone;
      if (!perfil?.cep) Object.assign(completar, enderecoDaPlanilha(payload.endereco));
      for (const k of Object.keys(completar)) if (completar[k] === null || completar[k] === undefined) delete completar[k];
      if (Object.keys(completar).length) {
        const { error } = await adminClient.from("profiles").update(completar).eq("user_id", userId);
        if (error) console.error("Error completing profile", error.code);
      }

      if (vinculo) {
        const { error } = await adminClient
          .from("organization_members")
          .update({ status: "active" })
          .eq("organization_id", organizationId)
          .eq("user_id", userId);
        if (error) return jsonResponse({ error: "Erro ao vincular a pessoa à academia." }, 500);
      } else {
        const { error } = await adminClient
          .from("organization_members")
          .insert({ organization_id: organizationId, user_id: userId, role: "aluno", status: "active" });
        if (error) return jsonResponse({ error: "Erro ao vincular a pessoa à academia." }, 500);
      }
      const { error: alunoError } = await adminClient.from("alunos").insert({
        organization_id: organizationId,
        user_id: userId,
        nivel_atacado: nivelAtacado,
        situacao_academia: situacaoAcademia,
        data_nascimento: dataNascimento,
      });
      if (alunoError) {
        console.error("Error inserting aluno for existing account", alunoError.code);
        // Desfaz só o que esta chamada criou: o vínculo novo. Um vínculo que já
        // existia volta ao que era.
        if (vinculo) {
          await adminClient.from("organization_members").update({ status: vinculo.status }).eq("organization_id", organizationId).eq("user_id", userId);
        } else {
          await adminClient.from("organization_members").delete().eq("organization_id", organizationId).eq("user_id", userId);
        }
        const limite = alunoError.message?.toLowerCase().includes("limite");
        return jsonResponse({ error: limite ? alunoError.message : "Erro ao criar o cadastro do aluno." }, limite ? 409 : 500);
      }

      const aviso = semEmail
        ? null
        : await avisarMatricula(adminClient, {
            userId,
            email,
            nome: perfil?.full_name?.trim() || fullName,
            organizationId,
            criarSenha: !conta.ultimo_acesso,
            siteUrl,
          });
      return jsonResponse({ user_id: userId, conta_existente: true, aviso, sem_email: semEmail });
    }

    const { data: invited, error: inviteError } = semEmail
      ? await adminClient.auth.admin.createUser({ email, user_metadata: { full_name: fullName } })
      : await adminClient.auth.admin.inviteUserByEmail(email, {
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
      // O limite de e-mails do login vale para o projeto inteiro, e não só
      // para esta academia: a importação para aqui e retoma depois.
      if (inviteError?.status === 429 || /rate limit/i.test(inviteError?.message ?? "")) {
        return jsonResponse(
          {
            error:
              "O limite de e-mails de convite por hora foi atingido. Retome daqui a uma hora: o que falta fica guardado.",
          },
          429
        );
      }
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
          data_nascimento: dataNascimento,
        });
      if (alunoError) {
        console.error("Error inserting aluno", alunoError);
        await adminClient.from("organization_members").delete().eq("user_id", newUserId);
        await rollback();
        return jsonResponse({ error: "Erro ao criar o cadastro do aluno." }, 500);
      }
    }

    return jsonResponse({ user_id: newUserId, sem_email: semEmail });
  } catch (error) {
    console.error("Unexpected error in convidar-membro", error);
    return jsonResponse({ error: "Erro inesperado ao processar o convite." }, 500);
  }
});

// O aviso por e-mail a quem já tinha conta: a matrícula nova, com o link de
// entrar na academia, ou o de criar a senha se a pessoa nunca entrou. Falha
// no aviso não desfaz a matrícula: volta como aviso para a tela.
async function avisarMatricula(
  admin: SupabaseClient,
  o: { userId: string; email: string; nome: string; organizationId: string; criarSenha: boolean; siteUrl: string }
): Promise<string | null> {
  const falhou = "A matrícula foi ligada à conta, mas o aviso por e-mail não saiu. Avise a pessoa de que ela já pode entrar.";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return falhou;
  const { data: org } = await admin.from("organizations").select("nome, slug").eq("id", o.organizationId).maybeSingle();
  const academia = (org?.nome as string | undefined) ?? "sua academia";
  let link = org?.slug ? `${o.siteUrl}/#/p/${org.slug}/entrar` : `${o.siteUrl}/#/auth/login`;
  if (o.criarSenha) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: o.email,
      options: { redirectTo: `${o.siteUrl}/#/auth/definir-senha` },
    });
    if (error || !data?.properties?.action_link) return falhou;
    link = data.properties.action_link;
  }
  const conteudo = emailMatriculaNova({ nome: o.nome, academia, link, criarSenha: o.criarSenha });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>",
        to: [o.email],
        subject: conteudo.assunto,
        html: conteudo.html,
        text: conteudo.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      console.error("convidar-membro: Resend", r.status);
      return falhou;
    }
    return null;
  } catch {
    return falhou;
  }
}

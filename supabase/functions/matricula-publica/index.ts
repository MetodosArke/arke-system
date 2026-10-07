import { createClient } from "npm:@supabase/supabase-js@2";
import { verificarCaptcha } from "../_shared/captcha.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { linkDoApp } from "../_shared/linkDoApp.ts";
import { erroDataNascimento } from "../_shared/nascimento.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import {
  CONTA_JA_EXISTE,
  ORIGEM_MATRICULA_PUBLICA,
  ROTA_DEFINIR_SENHA,
  TELA_ANTIGA,
  contaJaExiste,
  veioDaTelaAntiga,
} from "./fluxo.ts";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * CPF da matrícula: obrigatório e com dígito verificador conferido.
 *
 * Duplicado de `src/lib/cpf.ts` de propósito, pelo motivo de sempre: edge
 * function roda em Deno e não importa do bundle do app. O banco também tem
 * `public.cpf_valido()`, e é ele quem garante a validade — isto existe para
 * a mensagem chegar ao aluno em português, na hora, em vez de voltar como
 * violação de constraint.
 */
function erroCpfMatricula(valor: string | null): string | null {
  const cpf = (valor ?? "").replace(/\D/g, "");
  if (!cpf) return "Informe o CPF — é obrigatório para a matrícula.";
  if (cpf.length !== 11) return "CPF deve ter 11 dígitos.";
  if (/^(\d)\1{10}$/.test(cpf)) return "CPF inválido — confira os dígitos.";
  const digito = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto >= 10 ? 0 : resto;
  };
  if (digito(cpf.slice(0, 9), 10) !== Number(cpf[9])) return "CPF inválido — confira os dígitos.";
  if (digito(cpf.slice(0, 10), 11) !== Number(cpf[10])) return "CPF inválido — confira os dígitos.";
  return null;
}

// A conferência de senha vazada (Pwned Passwords, k-anonimato, falha aberta)
// morava aqui até 07/10/2026, porque era aqui que a senha nascia. A senha
// passou a nascer nas telas de definir e redefinir senha, e a conferência foi
// junto (`src/lib/senhaVazada.ts`, `senhaVazada.guarda.test.ts`).

const MUITAS_TENTATIVAS =
  "Muitas tentativas de matrícula a partir desta rede. Aguarde alguns minutos e tente de novo — " +
  "se estiver na academia, a recepção pode ajudar a concluir.";

/**
 * IP de quem chamou, para o limite de taxa. O Supabase entrega em
 * `x-forwarded-for`, e o primeiro endereço da lista é o do cliente.
 */
function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

/**
 * IP é dado pessoal: o banco guarda só o hash, com uma pimenta que não sai
 * daqui. Sem ela, o hash de IPv4 se reverte por força bruta em segundos —
 * são só 4 bilhões de possibilidades. A service role key serve de pimenta
 * porque já está no ambiente da função e nunca vai ao cliente; se ela for
 * trocada, os hashes antigos perdem o sentido, o que numa janela de 24 h
 * não custa nada.
 */
async function hashDoIp(ip: string, pimenta: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pimenta}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Captcha (Cloudflare Turnstile) -----------------------------------------
//
// Segunda camada, por cima do limite por IP: o limite segura o script que sai
// de um endereço só, o captcha segura o que se espalha por muitos. Ligado pelo
// secret TURNSTILE_SECRET_KEY — sem ele a matrícula segue como antes, e a tela
// só mostra o widget com VITE_TURNSTILE_SITE_KEY. Turnstile, e não reCAPTCHA:
// não pede ao aluno para clicar em imagens e não usa cookie de rastreamento.
//
// Falha aberta quando a Cloudflare não responde, pelo mesmo motivo do limitador:
// indisponibilidade de terceiro não pode fechar a matrícula no dia em que a
// academia divulga o link. Token ausente ou recusado, esse sim, barra.
// A verificação mora em _shared/captcha.ts, igual para os três endpoints públicos.

type MatriculaPayload = {
  slug: string;
  full_name: string;
  email: string;
  telefone?: string;
  cpf?: string;
  // AAAA-MM-DD. Obrigatória desde 06/10/2026: diz quem é menor de idade, e
  // para o menor saúde, biometria e IA esperam o aceite do responsável.
  data_nascimento?: string;
  captcha_token?: string;
  aceite_termos?: boolean;
};

// Auto-matrícula pública (rota /p/:slug): qualquer visitante pode se
// matricular como aluno da organização do slug, sem convite da academia.
//
// A conta nasce SEM senha e sem o e-mail confirmado (07/10/2026, ver
// ./fluxo.ts): a pessoa recebe no e-mail o link de criar a senha, o mesmo do
// primeiro acesso, e só entra depois dele. Quem digita o e-mail de outra
// pessoa não recebe o link e não tem como entrar na conta.
servir("matricula-publica", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Limite por IP antes de qualquer validação: um script que martela o
  // endpoint com lixo também precisa ser contido, não só o que acerta o
  // formato. Os números e o porquê de serem folgados (Wi-Fi da academia sai
  // todo pelo mesmo IP) estão na migration 20261127010000.
  //
  // Falha do limitador libera em vez de travar: se o banco estiver com
  // problema, a matrícula falharia de qualquer jeito logo adiante, e travar
  // aqui só trocaria uma mensagem honesta por uma falsa de "muitas
  // tentativas".
  let tentativaId: number | null = null;
  const ip = ipDoCliente(req);
  if (ip) {
    const { data, error } = await admin.rpc("registrar_tentativa_matricula", {
      _ip_hash: await hashDoIp(ip, serviceRoleKey),
    });
    if (error) {
      console.error("Limitador da matrícula indisponível, seguindo sem limite:", resumoDoErro(error));
    } else if (data === null) {
      return jsonResponse({ error: MUITAS_TENTATIVAS }, 429);
    } else {
      tentativaId = Number(data);
    }
  } else {
    console.error("Requisição sem IP identificável; limite por IP não aplicado.");
  }

  try {
    const payload: Partial<MatriculaPayload> = await req.json();
    // A tela de antes desta regra manda a senha e entra com ela em seguida:
    // recusa antes de criar qualquer coisa (ver ./fluxo.ts).
    if (veioDaTelaAntiga(payload)) return jsonResponse({ error: TELA_ANTIGA }, 400);

    const slug = payload.slug?.trim().toLowerCase();
    const fullName = payload.full_name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;

    if (!slug) return jsonResponse({ error: "Academia inválida." }, 400);
    if (!fullName) return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    if (!email || !EMAIL_RE.test(email)) return jsonResponse({ error: "E-mail inválido." }, 400);
    // CPF é obrigatório na matrícula: ela é o cadastro que gera cobrança, e o
    // gateway não emite cobrança sem CPF. A tela também confere, mas é aqui
    // que a regra vale — a tela pode ser contornada, a função é o caminho.
    const cpfErro = erroCpfMatricula(cpf);
    if (cpfErro) return jsonResponse({ error: cpfErro }, 400);
    const dataNascimento = typeof payload.data_nascimento === "string" ? payload.data_nascimento.trim() : "";
    const nascimentoErro = erroDataNascimento(dataNascimento, hojeBrasilia());
    if (nascimentoErro) return jsonResponse({ error: nascimentoErro }, 400);
    if (payload.aceite_termos !== true) {
      return jsonResponse({ error: "Aceite os Termos de Uso e a Política de Privacidade para continuar." }, 400);
    }

    const segredoCaptcha = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (segredoCaptcha) {
      const captcha = await verificarCaptcha(payload.captcha_token, ip, segredoCaptcha);
      if (captcha === "recusado") {
        return jsonResponse({ error: "Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo." }, 400);
      }
      if (captcha === "indisponivel") console.error("Turnstile indisponível; seguindo sem captcha nesta matrícula.");
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, status, onboarding_completed")
      .eq("slug", slug)
      .maybeSingle();

    if (orgError) {
      console.error("Error loading organization", resumoDoErro(orgError));
      return jsonResponse({ error: "Erro ao buscar a academia." }, 500);
    }
    if (!org || !["ativo", "trial"].includes(org.status)) {
      return jsonResponse({ error: "Academia não encontrada ou não está aceitando matrículas no momento." }, 404);
    }
    // D5: aluno no app só depois do onboarding da academia concluído.
    if (!org.onboarding_completed && org.status !== "trial") {
      return jsonResponse(
        { error: "A academia ainda está finalizando a configuração do app. As matrículas online abrem em breve." },
        409
      );
    }

    // Teto de volume por academia, que independe de quantos IPs o atacante
    // tenha. Sem ele, cada conta falsa conta contra o `limite_alunos` do
    // plano — o ataque trancaria a matrícula de quem é aluno de verdade.
    const { data: orgPermitida, error: orgLimiteError } = await admin.rpc("matricula_publica_org_permitida", {
      _organization_id: org.id,
    });
    if (orgLimiteError) {
      console.error("Teto por organização indisponível, seguindo sem ele:", resumoDoErro(orgLimiteError));
    } else if (orgPermitida === false) {
      return jsonResponse(
        { error: "Esta academia recebeu muitas matrículas na última hora. Tente de novo em alguns minutos." },
        429
      );
    }

    // A conta nasce sem senha e sem o e-mail confirmado: ninguém entra nela
    // antes de abrir o link do e-mail. A marca em `app_metadata` (que só o
    // servidor grava) é o que o banco lê para não ligar a ela outra academia
    // enquanto o e-mail não for confirmado, e para apagá-la se não for em 7
    // dias (migration 20261403010000).
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      user_metadata: { full_name: fullName },
      app_metadata: { origem: ORIGEM_MATRICULA_PUBLICA },
    });

    if (createError || !created.user) {
      console.error("matricula-publica: falha ao criar a conta", resumoDoErro(createError));
      // O e-mail que já tem conta: 409, como sempre foi.
      if (contaJaExiste(createError)) return jsonResponse({ error: CONTA_JA_EXISTE }, 409);
      // A mensagem do Auth não vai à tela: pode trazer o e-mail.
      return jsonResponse({ error: "Não foi possível criar a conta com esse e-mail. Confira o endereço e tente de novo." }, 400);
    }

    const newUserId = created.user.id;
    const rollback = async () => {
      await admin.auth.admin.deleteUser(newUserId).catch((e) => console.error("rollback deleteUser", resumoDoErro(e)));
    };

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" }, { onConflict: "user_id" });
    if (profileError) {
      console.error("Error upserting profile", resumoDoErro(profileError));
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .insert({ organization_id: org.id, user_id: newUserId, role: "aluno", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", resumoDoErro(membershipError));
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à academia." }, 500);
    }

    // Matrícula pública é matrícula no plano Free (22/09/2026). Antes ela
    // ativava o Método ARKE no nível escolhido sem gerar cobrança nenhuma —
    // o produto pago saía de graça pelo link. O Método é somado depois, pela
    // academia, quando estiver à venda.
    const { error: alunoError } = await admin.from("alunos").insert({
      organization_id: org.id,
      user_id: newUserId,
      data_nascimento: dataNascimento,
    });
    if (alunoError) {
      console.error("Error inserting aluno", resumoDoErro(alunoError));
      await admin.from("organization_members").delete().eq("user_id", newUserId);
      await rollback();
      return jsonResponse({ error: "Erro ao criar o cadastro de aluno." }, 500);
    }

    // Aceite dos documentos vigentes, registrado com a matrícula. Falha aqui
    // não desfaz a matrícula: o aceite é pedido de novo no primeiro login.
    const { data: docs } = await admin
      .from("documentos_legais")
      .select("id, tipo, publicado_em")
      .in("tipo", ["termos_uso", "privacidade"])
      .order("publicado_em", { ascending: false });
    const vigentes = ["termos_uso", "privacidade"]
      .map((t) => docs?.find((d) => d.tipo === t)?.id)
      .filter((id): id is string => !!id);
    if (vigentes.length) {
      const agente = req.headers.get("user-agent")?.slice(0, 300) ?? null;
      const { error: aceiteError } = await admin
        .from("aceites_documentos")
        .insert(vigentes.map((documento_id) => ({ documento_id, user_id: newUserId, user_agent: agente })));
      if (aceiteError) console.error("Falha ao registrar o aceite na matrícula:", aceiteError.code);
    }

    if (tentativaId !== null) {
      // Não bloqueia a resposta se falhar: a matrícula já existe, e perder
      // uma marcação só afrouxa o limite em uma unidade.
      const { error: conclusaoError } = await admin.rpc("concluir_tentativa_matricula", {
        _id: tentativaId,
        _organization_id: org.id,
      });
      if (conclusaoError) console.error("Falha ao marcar tentativa concluída:", resumoDoErro(conclusaoError));
    }

    // O link de criar a senha, pelo mesmo caminho do primeiro acesso: o
    // e-mail de recuperação do Auth (template "recovery" do send-email), que
    // leva a /auth/definir-senha. Abrir o link é o que confirma o e-mail.
    // Se o envio falhar (o Auth limita um e-mail por minuto por endereço), a
    // matrícula fica: a tela aponta o primeiro acesso, que pede o link de
    // novo. Sem confirmação em 7 dias, a rotina apaga a conta.
    const { error: envioError } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: linkDoApp(Deno.env.get("SITE_URL"), ROTA_DEFINIR_SENHA),
    });
    if (envioError) console.error("matricula-publica: o link de criar a senha não saiu", resumoDoErro(envioError));

    return jsonResponse({ ok: true, email_enviado: !envioError });
  } catch (error) {
    console.error("Unexpected error in matricula-publica", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao processar a matrícula." }, 500);
  }
});

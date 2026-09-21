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

const NIVEIS_VALIDOS = new Set(["essencial", "integrado", "elite"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Recusa senha que já aparece em vazamentos públicos, consultando o Pwned
 * Passwords do HaveIBeenPwned.
 *
 * O Supabase tem isso embutido a partir do plano pago; enquanto o projeto
 * está no free, esta é a substituta. A API não exige chave — diferente da
 * API de vazamento de contas do mesmo serviço.
 *
 * Esta é a única entrada de senha do sistema que passa por código nosso:
 * as outras telas falam direto com o GoTrue, e lá a checagem só pode ser
 * no cliente. Aqui ela é **autoritativa** — não dá para contornar
 * chamando a função na mão, porque a função é o caminho.
 *
 * A senha não trafega: manda-se só os 5 primeiros caracteres do SHA-1
 * (k-anonimato) e a comparação do sufixo acontece aqui.
 */
async function senhaEstaVazada(senha: string): Promise<{ vazada: boolean; ocorrencias: number }> {
  const limpo = { vazada: false, ocorrencias: 0 };
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(senha));
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), 4000);
    let corpo: string;
    try {
      const resposta = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
        // Preenche a resposta com registros falsos para que o tamanho dela
        // não entregue a faixa consultada.
        headers: { "Add-Padding": "true" },
        signal: controlador.signal,
      });
      if (!resposta.ok) return limpo;
      corpo = await resposta.text();
    } finally {
      clearTimeout(timer);
    }

    const sufixo = hash.slice(5);
    for (const linha of corpo.split("\n")) {
      const [s, c] = linha.trim().split(":");
      if (s?.toUpperCase() !== sufixo) continue;
      const n = Number.parseInt(c ?? "0", 10);
      // Contagem zero é registro de preenchimento, não senha vazada.
      return Number.isFinite(n) && n > 0 ? { vazada: true, ocorrencias: n } : limpo;
    }
    return limpo;
  } catch (erro) {
    // Falha aberta: o HIBP fora do ar não pode impedir alguém de se
    // matricular. Isto é trava de qualidade de senha, não fronteira de
    // segurança — transformar indisponibilidade de terceiro em matrícula
    // bloqueada troca um risco pequeno por uma falha certa.
    console.error("Falha ao consultar Pwned Passwords, seguindo sem checar:", erro);
    return limpo;
  }
}

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
type ResultadoCaptcha = "ok" | "recusado" | "indisponivel";

async function verificarCaptcha(token: string | undefined, ip: string | null, segredo: string): Promise<ResultadoCaptcha> {
  if (!token) return "recusado";
  const corpo = new FormData();
  corpo.append("secret", segredo);
  corpo.append("response", token);
  if (ip) corpo.append("remoteip", ip);
  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: corpo,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return "indisponivel";
    const resultado = (await resp.json()) as { success?: boolean };
    return resultado.success ? "ok" : "recusado";
  } catch {
    return "indisponivel";
  }
}

type MatriculaPayload = {
  slug: string;
  nivel_atacado: "essencial" | "integrado" | "elite";
  full_name: string;
  email: string;
  telefone?: string;
  cpf?: string;
  password: string;
  captcha_token?: string;
};

// Auto-matrícula pública (rota /p/:slug): qualquer visitante pode criar a
// própria conta de aluno vinculada à organização do slug, sem precisar de
// um convite de um gestor. Usa service_role para criar o usuário já com a
// senha escolhida pelo próprio aluno (sem e-mail de convite — o fluxo é
// self-service) e vinculá-lo como aluno da organização.
Deno.serve(async (req: Request) => {
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
      console.error("Limitador da matrícula indisponível, seguindo sem limite:", error);
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
    const slug = payload.slug?.trim().toLowerCase();
    const nivelAtacado = payload.nivel_atacado;
    const fullName = payload.full_name?.trim();
    const email = payload.email?.trim().toLowerCase();
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;
    const password = payload.password;

    if (!slug) return jsonResponse({ error: "Academia inválida." }, 400);
    if (!fullName) return jsonResponse({ error: "Nome completo é obrigatório." }, 400);
    if (!email || !EMAIL_RE.test(email)) return jsonResponse({ error: "E-mail inválido." }, 400);
    if (!password || password.length < 6) {
      return jsonResponse({ error: "A senha deve ter no mínimo 6 caracteres." }, 400);
    }
    if (!nivelAtacado || !NIVEIS_VALIDOS.has(nivelAtacado)) {
      return jsonResponse({ error: "Selecione um plano válido." }, 400);
    }

    const segredoCaptcha = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (segredoCaptcha) {
      const captcha = await verificarCaptcha(payload.captcha_token, ip, segredoCaptcha);
      if (captcha === "recusado") {
        return jsonResponse({ error: "Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo." }, 400);
      }
      if (captcha === "indisponivel") console.error("Turnstile indisponível; seguindo sem captcha nesta matrícula.");
    }

    const vazamento = await senhaEstaVazada(password);
    if (vazamento.vazada) {
      const vezes = vazamento.ocorrencias.toLocaleString("pt-BR");
      return jsonResponse(
        {
          error:
            `Esta senha já apareceu ${vezes} ${vazamento.ocorrencias === 1 ? "vez" : "vezes"} em ` +
            `vazamentos públicos de outros sites e é testada automaticamente por invasores. ` +
            `Escolha outra — não precisa ser complicada, só precisa ser sua.`,
        },
        400
      );
    }

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, status")
      .eq("slug", slug)
      .maybeSingle();

    if (orgError) {
      console.error("Error loading organization", orgError);
      return jsonResponse({ error: "Erro ao buscar a academia." }, 500);
    }
    if (!org || !["ativo", "trial"].includes(org.status)) {
      return jsonResponse({ error: "Academia não encontrada ou não está aceitando matrículas no momento." }, 404);
    }

    // Teto de volume por academia, que independe de quantos IPs o atacante
    // tenha. Sem ele, cada conta falsa conta contra o `limite_alunos` do
    // plano — o ataque trancaria a matrícula de quem é aluno de verdade.
    const { data: orgPermitida, error: orgLimiteError } = await admin.rpc("matricula_publica_org_permitida", {
      _organization_id: org.id,
    });
    if (orgLimiteError) {
      console.error("Teto por organização indisponível, seguindo sem ele:", orgLimiteError);
    } else if (orgPermitida === false) {
      return jsonResponse(
        { error: "Esta academia recebeu muitas matrículas na última hora. Tente de novo em alguns minutos." },
        429
      );
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created.user) {
      console.error("Error creating user", createError);
      const alreadyExists = createError?.message?.toLowerCase().includes("already been registered");
      return jsonResponse(
        {
          error: alreadyExists
            ? "Já existe uma conta cadastrada com esse e-mail. Faça login."
            : createError?.message ?? "Falha ao criar a conta.",
        },
        alreadyExists ? 409 : 400
      );
    }

    const newUserId = created.user.id;
    const rollback = async () => {
      await admin.auth.admin.deleteUser(newUserId).catch((e) => console.error("rollback deleteUser", e));
    };

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" }, { onConflict: "user_id" });
    if (profileError) {
      console.error("Error upserting profile", profileError);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await admin
      .from("organization_members")
      .insert({ organization_id: org.id, user_id: newUserId, role: "aluno", status: "active" });
    if (membershipError) {
      console.error("Error inserting organization_members", membershipError);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à academia." }, 500);
    }

    // Matrícula pública já é a adesão de verdade ao Método ARKE (o
    // aluno escolheu o nível e vai pagar por ele) — diferente do
    // cadastro/importação feito pela academia, aqui não faz sentido
    // nascer "sem_adesao".
    const { error: alunoError } = await admin.from("alunos").insert({
      organization_id: org.id,
      user_id: newUserId,
      nivel_atacado: nivelAtacado,
      metodo_arke_status: "ativo",
      metodo_arke_ativado_em: new Date().toISOString(),
    });
    if (alunoError) {
      console.error("Error inserting aluno", alunoError);
      await admin.from("organization_members").delete().eq("user_id", newUserId);
      await rollback();
      return jsonResponse({ error: "Erro ao criar o cadastro de aluno." }, 500);
    }

    if (tentativaId !== null) {
      // Não bloqueia a resposta se falhar: a matrícula já existe, e perder
      // uma marcação só afrouxa o limite em uma unidade.
      const { error: conclusaoError } = await admin.rpc("concluir_tentativa_matricula", {
        _id: tentativaId,
        _organization_id: org.id,
      });
      if (conclusaoError) console.error("Falha ao marcar tentativa concluída:", conclusaoError);
    }

    return jsonResponse({ user_id: newUserId });
  } catch (error) {
    console.error("Unexpected error in matricula-publica", error);
    return jsonResponse({ error: "Erro inesperado ao processar a matrícula." }, 500);
  }
});

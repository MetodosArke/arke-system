import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// "Primeiro acesso" por QR Code: o aluno que a academia já cadastrou digita o
// e-mail ou o celular e recebe no e-mail o próprio link para criar a senha.
// Um QR só por academia, em vez de um link por aluno enviado à mão.
//
// Endpoint público (verify_jwt = false), com as mesmas travas da matrícula
// pública: limite por IP (as funções de matricula_publica_tentativas), captcha
// Turnstile quando TURNSTILE_SECRET_KEY existe, e **resposta sempre igual** —
// exista ou não o cadastro —, para ninguém descobrir quem é aluno de qual
// academia digitando e-mails.
const RESPOSTA =
  "Se você está cadastrado nesta academia, enviamos para o seu e-mail um link para criar a sua senha. Confira também a caixa de spam.";

const MUITAS_TENTATIVAS = "Muitas tentativas a partir desta rede. Aguarde alguns minutos e tente de novo.";

function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

// Mesmo hash com pimenta da matrícula pública: IP é dado pessoal.
async function hashDoIp(ip: string, pimenta: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pimenta}:${ip}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Duplicado de matricula-publica (edge function não importa das outras).
async function verificarCaptcha(token: string | undefined, ip: string | null, segredo: string): Promise<"ok" | "recusado" | "indisponivel"> {
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
    return ((await resp.json()) as { success?: boolean }).success ? "ok" : "recusado";
  } catch {
    return "indisponivel";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const ip = ipDoCliente(req);
  if (ip) {
    const { data, error } = await admin.rpc("registrar_tentativa_matricula", { _ip_hash: await hashDoIp(ip, serviceRoleKey) });
    if (!error && data === null) return jsonResponse({ error: MUITAS_TENTATIVAS }, 429);
    if (error) console.error("primeiro-acesso: limitador indisponível, seguindo sem ele", error.code);
  }

  try {
    const { slug, contato, captcha_token } = (await req.json()) as { slug?: string; contato?: string; captcha_token?: string };
    if (!slug?.trim() || !contato?.trim()) return jsonResponse({ error: "Informe o e-mail ou o celular cadastrado." }, 400);

    const segredoCaptcha = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (segredoCaptcha) {
      const captcha = await verificarCaptcha(captcha_token, ip, segredoCaptcha);
      if (captcha === "recusado") {
        return jsonResponse({ error: "Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo." }, 400);
      }
    }

    const { data: org } = await admin.from("organizations").select("id, status").eq("slug", slug.trim().toLowerCase()).maybeSingle();
    if (!org || !["ativo", "trial"].includes(org.status)) return jsonResponse({ ok: true, mensagem: RESPOSTA });

    const { data: email, error: erroBusca } = await admin.rpc("buscar_aluno_primeiro_acesso", {
      _organization_id: org.id,
      _contato: contato.trim(),
    });
    if (erroBusca) {
      console.error("primeiro-acesso: falha na busca", erroBusca.code);
      return jsonResponse({ ok: true, mensagem: RESPOSTA });
    }

    if (email) {
      // Mesmo e-mail de recuperação do Auth (template "recovery" do send-email),
      // levando para /auth/definir-senha — o destino do link de ativação.
      const { error } = await admin.auth.resetPasswordForEmail(String(email), { redirectTo: `${siteUrl}/#/auth/definir-senha` });
      // O Auth limita um envio por minuto por e-mail; repetir cedo demais não é erro de quem pediu.
      if (error) console.error("primeiro-acesso: envio não aceito pelo Auth", error.status ?? error.name);
    }

    return jsonResponse({ ok: true, mensagem: RESPOSTA });
  } catch (erro) {
    console.error("primeiro-acesso: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

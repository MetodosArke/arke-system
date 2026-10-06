import { createClient } from "npm:@supabase/supabase-js@2";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import {
  ehProposito,
  erroDadosResponsavel,
  gerarTokenResponsavel,
  hashDoTokenResponsavel,
  type PropositoResponsavel,
} from "../_shared/responsavel.ts";
import { servir } from "../_shared/servir.ts";
import { emailResponsavel } from "./email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PedidoCriado = {
  id: string;
  expira_em: string;
  propositos: PropositoResponsavel[];
  pedido_pela: "aluno" | "academia";
  responsavel_nome: string;
  responsavel_email: string;
  aluno_primeiro_nome: string | null;
  academia: string | null;
};

// O pedido de aceite ao responsável legal do aluno menor (decisão do
// responsável, 06/10/2026). Quem pede: o próprio aluno, no app, ou a gestão e a
// recepção, para a digital e o rosto (o termo impresso).
//
// O pedido nasce no banco com a sessão de quem pede (`criar_pedido_responsavel`),
// para o banco conferir quem é, se a sessão é simulada, se o aluno é menor e o
// que pode ser pedido. Só depois disto, com a service role, entra o hash do
// token — o token mesmo nunca vai ao banco nem volta para a tela: existe só no
// e-mail. Por isso quem pede não consegue abrir o link e aceitar por ele.
//
// O e-mail sai pelo Resend com prazo e chave de idempotência; se não sair, o
// pedido é cancelado, para a tela não dizer "enviado" de um link que ninguém
// recebeu. Log só com status e código.
servir("responsavel-pedido", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return jsonResponse({ error: "O envio de e-mail está indisponível agora. Tente mais tarde." }, 503);
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br").replace(/\/+$/, "");
  const remetente = Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>";

  const corpo = (await req.json().catch(() => null)) as
    | { aluno_id?: unknown; nome?: unknown; email?: unknown; propositos?: unknown }
    | null;
  const alunoId = typeof corpo?.aluno_id === "string" && UUID_RE.test(corpo.aluno_id) ? corpo.aluno_id : null;
  if (!alunoId) return jsonResponse({ error: "Aluno inválido." }, 400);
  const erroDados = erroDadosResponsavel(corpo?.nome, corpo?.email);
  if (erroDados) return jsonResponse({ error: erroDados }, 400);
  const propositos = Array.isArray(corpo?.propositos) ? [...new Set(corpo.propositos.filter(ehProposito))] : [];
  if (!propositos.length) return jsonResponse({ error: "Escolha o que o responsável vai autorizar." }, 400);

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
  const quemPede = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (claimsError || !quemPede) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Cada pedido é um e-mail a alguém de fora: o freio segura o laço e quem
  // usaria o pedido para mandar e-mail a terceiros.
  const freio = [
    { chave: `responsavel:user:${quemPede}`, limite: 10, janelaSeg: 60 * 60 },
    { chave: `responsavel:aluno:${alunoId}`, limite: 5, janelaSeg: 24 * 60 * 60 },
    { chave: "responsavel:total", limite: 500, janelaSeg: 60 * 60 },
  ];
  if (!(await dentroDoFreio(admin, freio))) return jsonResponse({ error: MENSAGEM_FREIO }, 429);

  const { data, error } = await asUser.rpc("criar_pedido_responsavel", {
    _aluno_id: alunoId,
    _nome: String(corpo?.nome),
    _email: String(corpo?.email),
    _propositos: propositos,
  });
  if (error) {
    // P0001 é a recusa escrita para a pessoa; 42501, a de permissão.
    if (error.code === "P0001") return jsonResponse({ error: error.message }, 400);
    if (error.code === "42501") return jsonResponse({ error: error.message }, 403);
    console.error("responsavel-pedido: criar", error.code);
    return jsonResponse({ error: "Não foi possível registrar o pedido agora. Tente de novo." }, 500);
  }
  const pedido = data as PedidoCriado;

  const token = gerarTokenResponsavel();
  const tokenHash = await hashDoTokenResponsavel(token);
  const { data: reservado, error: erroReserva } = await admin
    .from("responsavel_pedidos")
    .update({ token_hash: tokenHash })
    .eq("id", pedido.id)
    .is("token_hash", null)
    .is("cancelado_em", null)
    .select("id");
  if (erroReserva || !reservado?.length) {
    console.error("responsavel-pedido: token", erroReserva?.code ?? "sem linha");
    return jsonResponse({ error: "Não foi possível registrar o pedido agora. Tente de novo." }, 500);
  }

  const email = emailResponsavel({
    responsavelNome: pedido.responsavel_nome,
    alunoPrimeiroNome: pedido.aluno_primeiro_nome,
    academia: pedido.academia,
    propositos: pedido.propositos,
    link: `${siteUrl}/#/responsavel/${token}`,
    validoAte: new Date(pedido.expira_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    pedidoPela: pedido.pedido_pela,
  });

  let enviado = false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
        "Idempotency-Key": `responsavel-pedido/${pedido.id}`,
      },
      body: JSON.stringify({
        from: remetente,
        to: [pedido.responsavel_email],
        subject: email.assunto,
        html: email.html,
        text: email.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    enviado = r.ok;
    if (!r.ok) console.error("responsavel-pedido: Resend", r.status);
  } catch (erro) {
    console.error("responsavel-pedido: Resend", erro instanceof Error ? erro.name : typeof erro);
  }

  const agora = new Date().toISOString();
  if (!enviado) {
    const { error: erroCancelar } = await admin.from("responsavel_pedidos").update({ cancelado_em: agora }).eq("id", pedido.id);
    if (erroCancelar) console.error("responsavel-pedido: cancelar", erroCancelar.code);
    return jsonResponse({ error: "O e-mail ao responsável não saiu agora. Tente de novo em alguns minutos." }, 502);
  }
  const { error: erroEnviado } = await admin.from("responsavel_pedidos").update({ enviado_em: agora }).eq("id", pedido.id);
  if (erroEnviado) console.error("responsavel-pedido: enviado_em", erroEnviado.code);

  return jsonResponse({ ok: true, expira_em: pedido.expira_em, propositos: pedido.propositos });
});

import { createClient } from "npm:@supabase/supabase-js@2";
import { conversarComIA } from "../_shared/ia.ts";
import indice from "./artigos.json" with { type: "json" };
import type { Trecho } from "./indice.ts";
import {
  buscarTrechos,
  detectarIntencoes,
  diagnosticoAceito,
  montarEmailChamado,
  montarEntrada,
  publicosDoPapel,
  resumoSituacao,
  SISTEMA_ASSISTENTE,
  type Contexto,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Freio: por pessoa e por academia, em 24 horas. */
const LIMITE_PESSOA = 40;
const LIMITE_ACADEMIA = 150;
const PAPEIS_EQUIPE = ["gestor", "recepcao", "professor", "nutricionista"];
const ORDEM_PAPEL: Record<string, number> = { gestor: 0, recepcao: 1, professor: 2, nutricionista: 3 };

type Payload = {
  acao?: "perguntar" | "chamado";
  organization_id?: string;
  pergunta?: string;
  aluno?: string;
  resposta?: string | null;
  artigos?: string[];
};

// O assistente da academia (o Lucas, no plano dos agentes). Responde quando
// alguém da equipe pergunta, na Central de Ajuda do painel:
//
// - perguntar: acha os trechos da Central de Ajuda que respondem, monta os
//   cartões com a situação na hora (`assistente_contexto`, com a identidade de
//   quem pergunta) e, com a IA ligada, escreve a resposta em São Paulo a
//   partir dos trechos. A pergunta não é guardada; só o que mede o assistente.
// - chamado: guarda a pergunta como chamado para a ArkeFit e avisa por e-mail,
//   com a resposta indo para quem perguntou.
//
// Os botões dos cartões não passam por aqui: chamam a mesma rota da tela, com
// a permissão de quem clica.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);

  try {
    const payload: Payload = await req.json().catch(() => ({}));
    const acao = payload.acao ?? "perguntar";
    if (acao !== "perguntar" && acao !== "chamado") return jsonResponse({ error: "Ação inválida." }, 400);
    const orgId = typeof payload.organization_id === "string" && UUID_RE.test(payload.organization_id) ? payload.organization_id : null;
    if (!orgId) return jsonResponse({ error: "Informe a academia." }, 400);
    const pergunta = (payload.pergunta ?? "").trim();
    if (pergunta.length < 3) return jsonResponse({ error: "Escreva a sua dúvida." }, 400);
    if (pergunta.length > 1000) return jsonResponse({ error: "A dúvida passou de 1.000 caracteres. Resuma um pouco." }, 400);

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !userId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Quem pergunta é da equipe DESTA academia: a unidade vem da tela e é
    // conferida, sem escolher entre vínculos.
    const { data: vinculos, error: vinculoError } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .eq("status", "active")
      .in("role", PAPEIS_EQUIPE);
    if (vinculoError) return jsonResponse({ error: "Erro ao conferir o seu acesso." }, 500);
    const papel = (vinculos ?? []).map((v) => v.role as string).sort((a, b) => (ORDEM_PAPEL[a] ?? 9) - (ORDEM_PAPEL[b] ?? 9))[0];
    if (!papel) return jsonResponse({ error: "O assistente é da equipe da academia." }, 403);

    const { data: cfg } = await admin.from("plataforma_config").select("chave, valor").in("chave", ["assistente_ativo", "assistente_ia"]);
    const ligado = (chave: string) => Number((cfg ?? []).find((c) => c.chave === chave)?.valor ?? 0) === 1;
    if (!ligado("assistente_ativo")) return jsonResponse({ error: "O assistente está desligado agora. A Central de Ajuda continua aqui embaixo." }, 503);

    const { data: org } = await admin.from("organizations").select("nome, tipo, especialidade_profissional").eq("id", orgId).maybeSingle();
    if (!org) return jsonResponse({ error: "Academia não encontrada." }, 404);
    const autonomo = org.tipo === "profissional_autonomo";

    if (acao === "chamado") return await abrirChamado();

    // Freio, antes de qualquer trabalho.
    const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [{ count: daPessoa }, { count: daAcademia }] = await Promise.all([
      admin.from("assistente_perguntas").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", desde),
      admin.from("assistente_perguntas").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", desde),
    ]);
    if ((daPessoa ?? 0) >= LIMITE_PESSOA || (daAcademia ?? 0) >= LIMITE_ACADEMIA) {
      return jsonResponse({ error: "Muitas perguntas nas últimas 24 horas. Use a busca da Central ou chame a ArkeFit." }, 429);
    }

    const aluno = (payload.aluno ?? "").trim().slice(0, 80);
    const intencoes = detectarIntencoes(pergunta);
    const publicos = publicosDoPapel(papel, autonomo, org.especialidade_profissional);
    const achados = buscarTrechos(indice as Trecho[], `${pergunta} ${aluno ? "aluno" : ""}`, publicos, 4);

    const { data: contexto, error: ctxError } = await asUser.rpc("assistente_contexto", {
      _organization_id: orgId,
      _intencoes: intencoes,
      _aluno: aluno || null,
    });
    if (ctxError) {
      console.error("assistente_contexto", ctxError.code);
      return jsonResponse({ error: ctxError.code === "42501" ? "O assistente é da equipe da academia." : "Erro ao ler a situação no sistema." }, ctxError.code === "42501" ? 403 : 500);
    }

    let resposta: string | null = null;
    let usouIa = false;
    if (ligado("assistente_ia")) {
      const situacao = resumoSituacao(contexto as Contexto, new Date());
      const entrada = montarEntrada(pergunta, achados, situacao);
      const r = await conversarComIA((n) => Deno.env.get(n), { sistema: SISTEMA_ASSISTENTE, usuario: entrada, maxTokens: 400, temperatura: 0.2 });
      if (r.ok) {
        usouIa = true;
        resposta = diagnosticoAceito(r.texto, entrada);
      }
    }

    const { data: registro } = await admin
      .from("assistente_perguntas")
      .insert({
        organization_id: orgId,
        user_id: userId,
        intencoes: [...intencoes, ...(aluno ? ["aluno"] : [])],
        artigos: achados.map((a) => a.slug),
        usou_ia: usouIa && !!resposta,
      })
      .select("id")
      .single();

    return jsonResponse({
      pergunta_id: registro?.id ?? null,
      resposta,
      intencoes,
      artigos: achados.map((a) => ({ slug: a.slug, titulo: a.artigo, secao: a.secao, trecho: a.texto.slice(0, 280) })),
      contexto,
    });

    async function abrirChamado() {
      // No máximo 5 chamados por pessoa por dia: chamado é para gente ler.
      const desdeDia = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { count } = await admin
        .from("chamados_suporte")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", desdeDia);
      if ((count ?? 0) >= 5) return jsonResponse({ error: "Você já abriu 5 chamados hoje. A ArkeFit responde por e-mail." }, 429);

      const resposta = typeof payload.resposta === "string" ? payload.resposta.trim().slice(0, 2000) || null : null;
      const artigos = Array.isArray(payload.artigos) ? payload.artigos.filter((a) => typeof a === "string" && /^[a-z0-9-]{2,60}$/.test(a)).slice(0, 6) : [];
      const { data: chamado, error } = await admin
        .from("chamados_suporte")
        .insert({ organization_id: orgId, user_id: userId, papel, pergunta, resposta_assistente: resposta, artigos })
        .select("id, prazo")
        .single();
      if (error || !chamado) {
        console.error("chamados_suporte insert", error?.code);
        return jsonResponse({ error: "Não foi possível abrir o chamado. Tente de novo." }, 500);
      }

      const aviso = await avisarArkefit(chamado.prazo as string, resposta, artigos);
      return jsonResponse({ chamado_id: chamado.id, prazo: chamado.prazo, aviso });
    }

    async function avisarArkefit(prazo: string, resposta: string | null, artigos: string[]): Promise<string | null> {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return "O chamado foi registrado, mas o aviso por e-mail não está configurado.";
      const { data: usuario } = await admin.auth.admin.getUserById(userId!);
      const email = usuario.user?.email ?? "";
      const { data: perfil } = await admin.from("profiles").select("full_name").eq("user_id", userId!).maybeSingle();
      const { data: textos } = await admin.from("plataforma_textos").select("valor").eq("chave", "suporte_email").maybeSingle();
      let para = textos?.valor?.trim() ? [textos.valor.trim()] : [];
      if (!para.length) {
        const { data: sa } = await admin.rpc("emails_superadmin");
        para = ((sa ?? []) as { email: string }[]).map((x) => x.email).filter(Boolean);
      }
      if (!para.length) return "O chamado foi registrado, mas não há e-mail de suporte configurado.";
      const prazoTexto = new Date(prazo).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const conteudo = montarEmailChamado({
        organizacao: org!.nome,
        autonomo,
        nome: perfil?.full_name?.trim() ?? "",
        email,
        papel,
        pergunta,
        resposta,
        artigos,
        prazo: prazoTexto,
        site: Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br",
      });
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_SUPORTE_FROM") ?? "ArkeFit <suporte@arkefit.com.br>",
            to: para,
            ...(email ? { reply_to: email } : {}),
            subject: conteudo.assunto,
            html: conteudo.html,
            text: conteudo.texto,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          console.error("assistente: Resend", r.status);
          return "O chamado foi registrado, e a ArkeFit vê na fila dela; o aviso por e-mail falhou.";
        }
        return null;
      } catch {
        return "O chamado foi registrado, e a ArkeFit vê na fila dela; o aviso por e-mail falhou.";
      }
    }
  } catch (erro) {
    console.error("Unexpected error in assistente-academia", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado no assistente." }, 500);
  }
});

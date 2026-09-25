import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { conversarComIA, fornecedorIA } from "../_shared/ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * O que o Sentinela faz com a anamnese — e o que ele nunca faz.
 *
 * Resumir para quem vai atender é útil; opinar sobre o que o aluno tem, não é
 * — e seria exercício ilegal de profissão além de risco clínico. A diferença
 * entre as duas coisas é toda a razão de este texto existir.
 */
const SISTEMA = `Você resume anamneses de alunos de academia para a equipe de acompanhamento.

O QUE VOCÊ FAZ: em no máximo 3 frases, destaque o que a equipe precisa saber antes do primeiro contato — histórico de lesão ou cirurgia, condição crônica mencionada, uso de medicamento relatado e nível de experiência. Escreva de forma objetiva e factual, citando apenas o que o aluno declarou.

O QUE VOCÊ NUNCA FAZ:
- Não diagnostica, não interpreta sintoma e não opina sobre gravidade.
- Não recomenda nem contraindica exercício, carga ou dieta.
- Não sugere medicamento, tratamento ou conduta clínica.
- Não infere nada que o aluno não tenha escrito.

Ao final, em uma linha separada, escreva exatamente "ATENCAO: SIM" se o aluno declarou lesão, cirurgia, condição crônica ou medicamento contínuo; caso contrário "ATENCAO: NAO".`;

// Auditoria preventiva da anamnese.
//
// **É a parte do Sentinela que mexe com dado sensível de saúde** (LGPD art.
// 5º, II), e por isso a única que exige consentimento específico e destacado
// do próprio aluno (art. 11, I).
//
// A trava não está aqui: `anamnese_para_auditoria` **recusa** sem
// consentimento, e é ela que entrega o texto. Conferir e obter são a mesma
// operação, então não existe caminho novo que esqueça de checar — inclusive
// os que alguém escrever depois.
//
// O resumo é **guardado por versão da anamnese** (hash), não gerado a cada
// abertura de tela: uma chamada por versão custa menos e, o que importa mais,
// **expõe menos** — cada chamada é um envio de dado de saúde a um terceiro.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Sessão inválida." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const { aluno_id: alunoId } = (await req.json()) as { aluno_id?: string };
    if (!alunoId) return jsonResponse({ error: "Pedido inválido." }, 400);

    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: aluno } = await admin
      .from("alunos")
      .select("id, organization_id")
      .eq("id", alunoId)
      .maybeSingle();
    if (!aluno) return jsonResponse({ error: "Aluno não encontrado." }, 404);

    // Quem atende o aluno: a célula da ArkeFit ou a equipe da academia.
    const [{ data: papeis }, { data: vinculo }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", callerId),
      admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", aluno.organization_id)
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    const arkefit = verificada(claims?.claims) && (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
    const equipe = ["gestor", "professor", "nutricionista", "recepcao"].includes(vinculo?.role ?? "");
    if (!arkefit && !equipe) {
      return jsonResponse({ error: "Você não atende este aluno." }, 403);
    }

    const { data: consentiu } = await admin.rpc("aluno_consentiu_ia", {
      _aluno_id: alunoId,
      _proposito: "anamnese",
    });
    if (!consentiu) {
      return jsonResponse({
        sem_consentimento: true,
        motivo:
          "O aluno ainda não autorizou a análise da anamnese por inteligência artificial, " +
          "ou autorizou uma versão anterior do termo e precisa autorizar de novo.",
      });
    }

    const fornecedor = fornecedorIA((n) => Deno.env.get(n));
    if (!fornecedor) {
      return jsonResponse({ indisponivel: true, motivo: "Sentinela desligado (sem chave de IA configurada)." });
    }

    const { data: texto, error: erroTexto } = await admin.rpc("anamnese_para_auditoria", { _aluno_id: alunoId });
    if (erroTexto) {
      // A recusa por consentimento vem daqui também, como segunda linha: a
      // primeira checagem acima é para dar mensagem boa, esta é a que garante.
      return jsonResponse({ sem_consentimento: true, motivo: "Autorização do aluno não encontrada." });
    }
    if (!texto || !String(texto).trim()) {
      return jsonResponse({ indisponivel: true, motivo: "Este aluno ainda não concluiu a anamnese." });
    }

    // Hash do conteúdo: é o que faz o resumo se regenerar quando a anamnese
    // muda, em vez de mostrar para sempre a análise de um texto que já não
    // existe — e o que evita reenviar dado de saúde sem necessidade.
    const bytes = new TextEncoder().encode(String(texto));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: existente } = await admin
      .from("sentinela_anamnese")
      .select("resumo, exige_atencao, created_at")
      .eq("aluno_id", alunoId)
      .eq("hash_anamnese", hash)
      .maybeSingle();
    if (existente) {
      return jsonResponse({ ...existente, reaproveitado: true, fornecedor });
    }

    const r = await conversarComIA((n) => Deno.env.get(n), {
      sistema: SISTEMA,
      usuario: `Anamnese declarada pelo aluno (sem identificação):\n${texto}`,
      maxTokens: 400,
    });
    if (!r.ok) return jsonResponse({ indisponivel: true, motivo: r.motivo });

    const exigeAtencao = /ATENCAO:\s*SIM/i.test(r.texto);
    const resumo = r.texto.replace(/ATENCAO:\s*(SIM|NAO)\s*$/i, "").trim();

    // Resumo antigo sai: manter duas versões faria a tela mostrar a análise de
    // uma anamnese que o aluno já corrigiu.
    await admin.from("sentinela_anamnese").delete().eq("aluno_id", alunoId);
    await admin.from("sentinela_anamnese").insert({
      organization_id: aluno.organization_id,
      aluno_id: alunoId,
      hash_anamnese: hash,
      resumo,
      exige_atencao: exigeAtencao,
      fornecedor,
    });

    return jsonResponse({ resumo, exige_atencao: exigeAtencao, reaproveitado: false, fornecedor });
  } catch (erro) {
    console.error("sentinela-anamnese: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

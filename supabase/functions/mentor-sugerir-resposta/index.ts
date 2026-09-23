import { createClient } from "npm:@supabase/supabase-js@2";
import { conversarComIA, fornecedorIA } from "../_shared/ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * As regras do Sentinela, e elas são quase todas proibições.
 *
 * A fronteira CREF/CRN não se garante com intenção: um modelo **deriva** para
 * conselho técnico se nada o impedir. O controle de verdade é o mentor
 * validando antes de enviar — nada daqui vira mensagem sozinho, nunca. Este
 * texto é a segunda camada, não a primeira.
 */
const SISTEMA = `Você ajuda a equipe de acompanhamento da ArkeFit a redigir respostas para alunos de academia.

O QUE VOCÊ FAZ: sugere uma resposta curta, acolhedora e em português do Brasil, que reconheça o que o aluno disse, faça uma pergunta investigativa e convide à continuidade.

O QUE VOCÊ NUNCA FAZ:
- Não prescreve nem altera treino, carga, série, exercício ou dieta.
- Não dá orientação clínica, diagnóstico, nem opinião sobre lesão, dor ou medicamento.
- Não promete resultado, prazo nem contato de profissional específico.
- Diante de relato de dor, lesão ou sintoma: acolhe, diz que a equipe técnica da academia vai avaliar presencialmente, e não sugere nenhuma conduta.

FORMA: no máximo 3 frases. Sem emoji. Sem saudação genérica do tipo "espero que esteja bem". Trate o aluno por "você".`;

// Sugestão de resposta para o Mentor Centralizado.
//
// **Nunca envia nada.** A saída é um rascunho que aparece no campo de texto do
// mentor, para ele editar ou descartar. Não existe e não vai existir modo
// automático: é o único controle que de fato impede a deriva para conselho
// técnico, e ele é humano, não de prompt.
//
// O contexto estruturado vai **pseudonimizado** — fase, dias sem sinal,
// constância. Nome, CPF, e-mail e id não saem daqui. A conversa vai como o
// aluno escreveu, e isso é limitação assumida: higienizá-la destruiria o
// sentido do que se quer sugerir. Está no termo, não numa promessa técnica.
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
    const { data: papeis } = await admin.from("user_roles").select("role").eq("user_id", callerId);
    const arkefit = (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
    if (!arkefit) return jsonResponse({ error: "Apenas a equipe da ArkeFit usa o Sentinela." }, 403);

    const { data: aluno } = await admin
      .from("alunos")
      .select("id, organization_id, fase_jornada, nivel_atacado, meta_semanal_dias, progressao_bloqueada_motivo")
      .eq("id", alunoId)
      .maybeSingle();
    if (!aluno) return jsonResponse({ error: "Aluno não encontrado." }, 404);

    // A conversa vem por `conversa_para_sugestao`, que RECUSA sem o
    // consentimento de propósito "chat". Ler `mensagens_mentor` direto aqui,
    // com a service role que ignora RLS, era um acesso em que esquecer a
    // checagem não dá erro nenhum — só manda o dado embora.
    //
    // As palavras do aluno vão como ele as escreveu, e ele pode ter digitado
    // dor, cirurgia ou medicamento. Higienizar isso destruiria o sentido do
    // que se quer sugerir, então a saída é a honesta: ele autoriza, sabendo.
    const [{ data: dias }, { data: constancia }, { data: conversa, error: erroConversa }] = await Promise.all([
      admin.rpc("aluno_dias_inativo", { _aluno_id: alunoId }),
      admin.rpc("aluno_constancia", { _aluno_id: alunoId, _semanas: 4 }),
      admin.rpc("conversa_para_sugestao", { _aluno_id: alunoId, _limite: 8 }),
    ]);

    if (erroConversa) {
      return jsonResponse({
        sem_consentimento: true,
        motivo:
          "O aluno não autorizou a análise das mensagens por inteligência artificial, " +
          "ou autorizou uma versão anterior do termo e precisa autorizar de novo.",
      });
    }

    if (!conversa) {
      return jsonResponse({ indisponivel: true, motivo: "Ainda não há conversa para sugerir resposta." });
    }

    // A checagem de chave vem DEPOIS da de consentimento, de propósito: se o
    // aluno não autorizou, é isso que o mentor precisa ouvir — dizer
    // "desligado" o deixaria clicando num botão que nunca ia responder por um
    // motivo que não é o que ele imagina. Nenhuma das duas ordens manda dado
    // a lugar nenhum; o que muda é a qualidade da resposta.
    const fornecedor = fornecedorIA((n) => Deno.env.get(n));
    if (!fornecedor) {
      return jsonResponse({ indisponivel: true, motivo: "Sentinela desligado (sem chave de IA configurada)." });
    }

    // Só o que ajuda a redigir. Nenhum identificador.
    const contexto = [
      `Fase da jornada: ${aluno.fase_jornada}`,
      `Plano: ${aluno.nivel_atacado ?? "não informado"}`,
      dias === null || dias === undefined ? null : `Dias sem sinal de vida no app: ${dias}`,
      constancia === null || constancia === undefined ? null : `Constância nas últimas 4 semanas: ${constancia}%`,
      aluno.meta_semanal_dias ? `Meta do aluno: ${aluno.meta_semanal_dias} treinos por semana` : null,
      aluno.progressao_bloqueada_motivo ? `Atenção: progressão suspensa (${aluno.progressao_bloqueada_motivo})` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const r = await conversarComIA((n) => Deno.env.get(n), {
      sistema: SISTEMA,
      usuario: `Contexto do aluno (sem identificação):\n${contexto}\n\nÚltimas mensagens:\n${conversa}\n\nSugira a resposta do Mentor.`,
      maxTokens: 300,
    });

    if (!r.ok) return jsonResponse({ indisponivel: true, motivo: r.motivo });

    // Registrado para medir o aproveitamento. Sem isto o recurso vira fé.
    const { data: registro } = await admin
      .from("sentinela_sugestoes")
      .insert({
        organization_id: aluno.organization_id,
        aluno_id: alunoId,
        mentor_id: callerId,
        sugestao: r.texto,
        fornecedor,
      })
      .select("id")
      .single();

    return jsonResponse({ sugestao: r.texto, sugestao_id: registro?.id ?? null, fornecedor });
  } catch (erro) {
    console.error("mentor-sugerir-resposta: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});

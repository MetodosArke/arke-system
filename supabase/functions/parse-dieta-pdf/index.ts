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

interface ItemExtraido {
  alimento: string;
  quantidade: string;
  substituicoes: string[];
}

interface RefeicaoExtraida {
  nome: string;
  horario: string | null;
  itens: ItemExtraido[];
}

interface DietaExtraida {
  titulo_dieta: string;
  observacoes_gerais: string | null;
  refeicoes: RefeicaoExtraida[];
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    titulo_dieta: { type: "STRING" },
    observacoes_gerais: { type: "STRING" },
    refeicoes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nome: { type: "STRING" },
          horario: { type: "STRING" },
          itens: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                alimento: { type: "STRING" },
                quantidade: { type: "STRING" },
                substituicoes: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["alimento", "quantidade"],
            },
          },
        },
        required: ["nome", "itens"],
      },
    },
  },
  required: ["titulo_dieta", "refeicoes"],
};

const SYSTEM_INSTRUCTION = `Você vai receber um PDF com um plano alimentar/dieta escrito por um nutricionista, possivelmente vindo de outro sistema ou digitado livremente.

Analise o conteúdo e devolva ESTRITAMENTE um JSON estruturado (sem markdown, sem texto antes ou depois) no formato:
{
  "titulo_dieta": "string (ex.: Plano Alimentar — Fase 1)",
  "observacoes_gerais": "string (orientações gerais do documento, ou string vazia se não houver)",
  "refeicoes": [
    {
      "nome": "string (ex.: Café da Manhã)",
      "horario": "string HH:MM (24h), ou string vazia se não houver horário explícito",
      "itens": [
        {
          "alimento": "string",
          "quantidade": "string (ex.: 2 unidades, 100g, 1 xícara)",
          "substituicoes": ["string", "..."]
        }
      ]
    }
  ]
}

Regras:
- "refeicoes" segue a ordem em que aparecem no documento.
- "substituicoes" lista as opções de troca explicitamente indicadas para aquele item (ex.: "pode substituir por..."). Se não houver nenhuma indicada, use uma lista vazia — não invente substituições.
- Não invente alimentos, quantidades ou observações que não estejam no documento.
- Se o documento não tiver nenhuma refeição identificável, devolva "refeicoes": [].
- Responda só com o JSON, nada mais.`;

function validarDietaExtraida(data: unknown): DietaExtraida {
  if (typeof data !== "object" || data === null) throw new Error("Resposta do modelo não é um objeto.");
  const d = data as Record<string, unknown>;
  if (typeof d.titulo_dieta !== "string") throw new Error("Campo titulo_dieta ausente ou inválido.");
  if (!Array.isArray(d.refeicoes)) throw new Error("Campo refeicoes ausente ou inválido.");

  const refeicoes: RefeicaoExtraida[] = d.refeicoes.map((r, i) => {
    if (typeof r !== "object" || r === null) throw new Error(`Refeição ${i} inválida.`);
    const ref = r as Record<string, unknown>;
    if (typeof ref.nome !== "string") throw new Error(`Refeição ${i} sem nome.`);
    const itens = Array.isArray(ref.itens)
      ? ref.itens.map((it, j) => {
          if (typeof it !== "object" || it === null) throw new Error(`Item ${j} da refeição ${i} inválido.`);
          const item = it as Record<string, unknown>;
          return {
            alimento: typeof item.alimento === "string" ? item.alimento : "",
            quantidade: typeof item.quantidade === "string" ? item.quantidade : "",
            substituicoes: Array.isArray(item.substituicoes)
              ? item.substituicoes.filter((s): s is string => typeof s === "string")
              : [],
          };
        })
      : [];
    return {
      nome: ref.nome,
      horario: typeof ref.horario === "string" && ref.horario.trim() ? ref.horario.trim() : null,
      itens,
    };
  });

  return {
    titulo_dieta: d.titulo_dieta,
    observacoes_gerais: typeof d.observacoes_gerais === "string" && d.observacoes_gerais.trim() ? d.observacoes_gerais : null,
    refeicoes,
  };
}

// Importação de dieta em PDF via Google Gemini (gemini-1.5-flash). Chamada
// autenticada pelo JWT do nutricionista/gestor — não grava nada no banco
// (só extrai e devolve para revisão), mas ainda assim custa dinheiro (API
// do Gemini), então fica restrita a staff qualificado da organização.
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
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

  if (!supabaseUrl || !anonKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  if (!geminiApiKey) {
    return jsonResponse(
      { error: "GEMINI_API_KEY não configurada. Peça pro time técnico configurar o secret no projeto Supabase." },
      500
    );
  }

  try {
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const { data: membership } = await asUser
      .from("organization_members")
      .select("role")
      .eq("user_id", callerId)
      .eq("status", "active")
      .in("role", ["gestor", "nutricionista", "admin_arke"])
      .maybeSingle();
    if (!membership) {
      return jsonResponse({ error: "Só a nutricionista ou o gestor podem importar dieta de PDF." }, 403);
    }

    const payload = await req.json();
    const fileBase64 = typeof payload?.file_base64 === "string" ? payload.file_base64 : null;
    if (!fileBase64) {
      return jsonResponse({ error: "file_base64 é obrigatório." }, 400);
    }
    // ~15MB de PDF em base64 já vira uns 20MB de payload — limite
    // generoso o bastante pra qualquer plano alimentar em PDF, sem
    // deixar alguém mandar um arquivo absurdo pra função.
    if (fileBase64.length > 20_000_000) {
      return jsonResponse({ error: "PDF muito grande (máximo ~15MB)." }, 413);
    }

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: "application/pdf", data: fileBase64 } },
                { text: SYSTEM_INSTRUCTION },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        }),
      }
    );

    if (!geminiResp.ok) {
      const detalhe = await geminiResp.text();
      console.error("Gemini API error", geminiResp.status, detalhe);
      return jsonResponse({ error: "Falha ao processar o PDF com o modelo de extração." }, 502);
    }

    const geminiData = await geminiResp.json();
    const textoResposta: string | undefined =
      geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");

    if (!textoResposta) {
      console.error("Resposta do Gemini sem conteúdo de texto", JSON.stringify(geminiData));
      return jsonResponse({ error: "O modelo não retornou nenhum conteúdo. Tente novamente." }, 502);
    }

    let dietaExtraida: DietaExtraida;
    try {
      const bruto = JSON.parse(textoResposta);
      dietaExtraida = validarDietaExtraida(bruto);
    } catch (parseErr) {
      console.error("Falha ao parsear/validar resposta do modelo", parseErr, textoResposta);
      return jsonResponse(
        { error: "Não consegui interpretar o PDF de forma estruturada. Tente um arquivo mais legível ou preencha manualmente." },
        422
      );
    }

    return jsonResponse(dietaExtraida);
  } catch (error) {
    console.error("Unexpected error in parse-dieta-pdf", error);
    return jsonResponse({ error: "Erro inesperado ao processar o PDF." }, 500);
  }
});

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

// O modelo não fica cravado no código. Em 20/09/2026 a importação de dieta
// estava quebrada em produção porque `gemini-1.5-flash` foi aposentado pelo
// Google e a API passou a responder 404 NOT_FOUND — a função seguia pedindo
// um modelo que não existe mais. Modelo de fornecedor é dado de ambiente,
// não constante de código: some sem aviso e não dá para depender de um
// deploy para reagir.
//
// GEMINI_MODEL, se definido, manda sozinho (controle explícito, sem sondagem).
// Sem ele, tenta os candidatos em ordem e memoriza o primeiro que responder.
const MODELOS_CANDIDATOS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

// Memória por isolate: uma vez descoberto o modelo vivo, as próximas
// requisições vão direto nele, sem repetir a sondagem.
let modeloResolvido: string | null = null;

type RespostaGemini =
  | { ok: true; dados: unknown }
  | { ok: false; status: number; detalhe: string; modelo: string };

async function chamarGemini(fileBase64: string, apiKey: string, modelo: string): Promise<Response> {
  return await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
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
}

async function extrairComGemini(fileBase64: string, apiKey: string): Promise<RespostaGemini> {
  const fixo = Deno.env.get("GEMINI_MODEL");
  const candidatos = fixo ? [fixo] : modeloResolvido ? [modeloResolvido] : MODELOS_CANDIDATOS;

  let ultimo: { status: number; detalhe: string; modelo: string } | null = null;

  for (const modelo of candidatos) {
    const resp = await chamarGemini(fileBase64, apiKey, modelo);

    if (resp.ok) {
      if (modeloResolvido !== modelo) {
        modeloResolvido = modelo;
        console.log(`Modelo Gemini em uso: ${modelo}`);
      }
      return { ok: true, dados: await resp.json() };
    }

    const detalhe = await resp.text();
    ultimo = { status: resp.status, detalhe, modelo };
    console.error(`Gemini recusou o modelo ${modelo}: ${resp.status} ${detalhe}`);

    // Só faz sentido tentar outro modelo quando o erro é "esse modelo não
    // existe". Chave inválida, cota estourada ou erro do Google não melhoram
    // trocando de modelo — insistir só queima quota e atrasa a resposta.
    if (resp.status !== 404) break;

    // O modelo memorizado morreu: limpa para a próxima sondar do zero.
    if (modeloResolvido === modelo) modeloResolvido = null;
  }

  return {
    ok: false,
    ...(ultimo ?? { status: 502, detalhe: "sem resposta do Gemini", modelo: "desconhecido" }),
  };
}

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

// Importação de dieta em PDF via Google Gemini (modelo resolvido em
// tempo de execução, ver MODELOS_CANDIDATOS/GEMINI_MODEL acima). Chamada
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

    // Lista, não `.maybeSingle()`: quem tem vínculo ativo em duas
    // organizações fazia a consulta falhar e levava 403 mesmo sendo
    // nutricionista — mesma classe de defeito já corrigida no AuthContext.
    const { data: vinculos } = await asUser
      .from("organization_members")
      .select("role")
      .eq("user_id", callerId)
      .eq("status", "active")
      .in("role", ["gestor", "nutricionista", "admin_arke"]);
    if (!vinculos?.length) {
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

    const resultado = await extrairComGemini(fileBase64, geminiApiKey);

    if (!resultado.ok) {
      // A mensagem genérica de antes ("Falha ao processar o PDF") escondeu
      // que o modelo tinha sido aposentado. O motivo real vai para a tela:
      // quem importa dieta é quem vai acionar o suporte.
      const motivo =
        resultado.status === 404
          ? `O modelo de extração "${resultado.modelo}" não está mais disponível no Google. Configure GEMINI_MODEL no projeto Supabase com um modelo atual.`
          : resultado.status === 429
            ? "Cota da API do Gemini esgotada. Tente de novo em alguns minutos."
            : resultado.status === 400 || resultado.status === 403
              ? "A GEMINI_API_KEY foi recusada pelo Google. Verifique o secret no projeto Supabase."
              : `O Gemini respondeu ${resultado.status} ao processar o PDF.`;
      return jsonResponse({ error: motivo, gemini_status: resultado.status, modelo: resultado.modelo }, 502);
    }

    const geminiData = resultado.dados as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
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

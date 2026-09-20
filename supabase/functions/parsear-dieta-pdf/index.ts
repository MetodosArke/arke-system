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

interface RefeicaoExtraida {
  ordem: number;
  nome_refeicao: string;
  horario_sugerido: string | null;
  itens: string | null;
  calorias_kcal: number | null;
  proteinas_g: number | null;
  carboidratos_g: number | null;
  gorduras_g: number | null;
}

const EXTRACTION_PROMPT = `Você vai receber um PDF com um plano alimentar/dieta escrito por um nutricionista, possivelmente vindo de outro sistema ou digitado livremente.

Extraia cada refeição do documento e devolva SOMENTE um JSON (sem markdown, sem texto antes ou depois) no formato:

{
  "refeicoes": [
    {
      "ordem": 1,
      "nome_refeicao": "Café da manhã",
      "horario_sugerido": "07:30",
      "itens": "2 ovos mexidos, 1 fatia de pão integral, 1 fruta",
      "calorias_kcal": 350,
      "proteinas_g": 20,
      "carboidratos_g": 40,
      "gorduras_g": 10
    }
  ]
}

Regras:
- "ordem" começa em 1 e segue a ordem em que as refeições aparecem no documento.
- "horario_sugerido" no formato HH:MM (24h). Se não houver horário explícito, use null.
- "itens" é um resumo em texto livre dos alimentos e quantidades daquela refeição, como está no documento.
- Os campos de macro (calorias_kcal, proteinas_g, carboidratos_g, gorduras_g) só devem ser preenchidos se estiverem explicitamente no documento (por refeição ou you podem ser somados a partir de itens individuais claramente quantificados). Se não for possível determinar com confiança, use null — não invente valores.
- Se o documento não tiver nenhuma refeição identificável, devolva {"refeicoes": []}.
- Responda só com o JSON, nada mais.`;

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
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!supabaseUrl || !anonKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  if (!anthropicApiKey) {
    return jsonResponse(
      { error: "ANTHROPIC_API_KEY não configurada. Peça pro time técnico configurar o secret no projeto Supabase." },
      500
    );
  }

  try {
    // Confirma que quem chama é staff de alguma organização — não grava
    // nada no banco (só extrai e devolve), mas ainda assim é uma chamada
    // que custa dinheiro (API da Anthropic), então não fica aberta a
    // qualquer usuário autenticado.
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

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicResp.ok) {
      const detalhe = await anthropicResp.text();
      console.error("Anthropic API error", anthropicResp.status, detalhe);
      return jsonResponse({ error: "Falha ao processar o PDF com o modelo de extração." }, 502);
    }

    const anthropicData = await anthropicResp.json();
    const textoResposta: string = (anthropicData.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    let extraido: { refeicoes: RefeicaoExtraida[] };
    try {
      // O modelo às vezes envolve em ```json apesar da instrução — remove antes de parsear.
      const limpo = textoResposta.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
      extraido = JSON.parse(limpo);
    } catch (parseErr) {
      console.error("Falha ao parsear resposta do modelo", parseErr, textoResposta);
      return jsonResponse({ error: "Não consegui interpretar o PDF de forma estruturada. Tenta um arquivo mais legível ou preenche manualmente." }, 422);
    }

    const refeicoes = Array.isArray(extraido?.refeicoes) ? extraido.refeicoes : [];
    return jsonResponse({ refeicoes });
  } catch (error) {
    console.error("Unexpected error in parsear-dieta-pdf", error);
    return jsonResponse({ error: "Erro inesperado ao processar o PDF." }, 500);
  }
});

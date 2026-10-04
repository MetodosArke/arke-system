import { createClient } from "npm:@supabase/supabase-js@2";
import { conversarComIA } from "../_shared/ia.ts";
import {
  avaliarLeitura,
  conferirNoOriginal,
  LIMITE_TEXTO,
  lerResposta,
  SISTEMA,
  temTextoSuficiente,
  tirarIdentificacao,
} from "./fluxo.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Leitura de plano alimentar em PDF (voltou em 25/09/2026, agora no Brasil).
// Recebe só o TEXTO que o navegador extraiu do PDF — o arquivo não sai do
// aparelho —, tira as linhas de identificação, lê com o modelo em São Paulo
// (`_shared/ia.ts`, a mesma porta do Sentinela) e devolve a dieta conferida
// contra o original (`fluxo.ts`). Não grava nada: quem salva é a tela, depois
// da revisão da nutricionista. Nem o texto nem a resposta vão para log.
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
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    // Lista, não `.maybeSingle()`: vínculo em duas academias não pode virar 403.
    const { data: vinculos } = await asUser
      .from("organization_members")
      .select("role")
      .eq("user_id", callerId)
      .eq("status", "active")
      .in("role", ["gestor", "nutricionista"]);
    // A equipe da ArkeFit prescreve a dieta do aluno do Método. A pergunta vai
    // ao banco com a sessão de quem chama: lá o papel da ArkeFit só vale com a
    // verificação em duas etapas.
    const daArkefit = vinculos?.length ? false : (await asUser.rpc("equipe_metodo")).data === true;
    if (!vinculos?.length && !daArkefit) {
      return jsonResponse({ error: "Só a nutricionista, o gestor ou a equipe da ArkeFit podem importar dieta de PDF." }, 403);
    }

    // Cada leitura é uma chamada ao modelo, que se paga por uso. Uma
    // nutricionista importa algumas dietas por dia; um laço, centenas.
    const freio = [
      { chave: `ia:dieta:user:${callerId}`, limite: 30, janelaSeg: 60 * 60 },
      { chave: `ia:dieta:user-dia:${callerId}`, limite: 100, janelaSeg: 24 * 60 * 60 },
      { chave: "ia:dieta:total", limite: 300, janelaSeg: 60 * 60 },
    ];
    if (!(await dentroDoFreio(createClient(supabaseUrl, serviceRoleKey), freio))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    const corpo = await req.json().catch(() => null);
    const texto = typeof corpo?.texto === "string" ? corpo.texto : "";
    if (!temTextoSuficiente(texto)) {
      return jsonResponse(
        {
          error:
            "Este PDF não tem texto para ler: provavelmente é uma imagem (digitalizado). Exporte o PDF direto do programa em que a dieta foi montada, ou digite a dieta.",
        },
        422,
      );
    }
    if (texto.length > LIMITE_TEXTO) return jsonResponse({ error: "O PDF é longo demais para um plano alimentar." }, 413);

    const { texto: semIdentificacao } = tirarIdentificacao(texto);
    const resposta = await conversarComIA((n) => Deno.env.get(n), {
      sistema: SISTEMA,
      usuario: semIdentificacao,
      maxTokens: 4000,
      temperatura: 0,
    });
    if (!resposta.ok) {
      return jsonResponse({ error: "A leitura automática não está disponível agora. Tente de novo em instantes, ou digite a dieta." }, 503);
    }

    let dieta;
    try {
      dieta = lerResposta(resposta.texto);
    } catch {
      return jsonResponse({ error: "Não conseguimos montar as refeições a partir deste PDF. Digite a dieta, ou tente outro arquivo." }, 422);
    }

    const conferida = conferirNoOriginal(dieta, texto);
    const veredito = avaliarLeitura(conferida.itens, conferida.semAncora);
    if (!veredito.ok) return jsonResponse({ error: veredito.motivo }, 422);

    return jsonResponse({ ...conferida.dieta, itens_para_conferir: conferida.semAncora });
  } catch (e) {
    // Só o tipo do erro: a mensagem pode carregar trecho do texto.
    console.error("importar-dieta-pdf: falha", e instanceof Error ? e.name : typeof e);
    return jsonResponse({ error: "Não foi possível ler o PDF agora. Tente de novo." }, 500);
  }
});

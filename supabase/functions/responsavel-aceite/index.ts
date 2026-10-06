import { createClient } from "npm:@supabase/supabase-js@2";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { ehProposito, hashDoTokenResponsavel, TEXTOS_RESPONSAVEL } from "../_shared/responsavel.ts";
import { servir } from "../_shared/servir.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

// A página do link que o responsável legal do aluno menor recebe por e-mail
// (decisão do responsável, 06/10/2026). Pública (verify_jwt = false): quem
// abre não tem conta. A trava é o token, de 256 bits, que só existe no e-mail —
// o banco guarda o hash e procura por ele.
//
// Duas ações:
//   * consultar: o primeiro nome do aluno, a academia e os propósitos pedidos.
//     Só leitura; o robô que abre links de e-mail para conferir não aceita nada;
//   * aceitar: os propósitos marcados, com a versão do texto que a página
//     mostrou. A versão tem de ser a desta tabela (que é a do banco), e o hash
//     gravado é o desta tabela: o aceite registra o texto que o sistema
//     mostrou, e não um número que o navegador mandou.
//
// Quem abre o link logado no app manda a própria sessão junto: o banco recusa
// o aceite do próprio aluno e o da sessão simulada.
servir("responsavel-aceite", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const corpo = (await req.json().catch(() => null)) as
    | { acao?: unknown; token?: unknown; nome?: unknown; propositos?: unknown; versoes?: unknown }
    | null;
  const acao = corpo?.acao;
  if (acao !== "consultar" && acao !== "aceitar") return jsonResponse({ error: "Ação inválida." }, 400);

  const tokenHash = await hashDoTokenResponsavel(typeof corpo?.token === "string" ? corpo.token : null);
  if (!tokenHash) {
    return acao === "consultar" ? jsonResponse({ situacao: "inexistente" }) : jsonResponse({ error: "Link inválido." }, 404);
  }

  // O token não se acha por tentativa (256 bits); o freio segura o laço.
  const ip = ipDoCliente(req);
  const freio = [
    ...(ip ? [{ chave: `responsavel-aceite:ip:${await hashDoIp(ip, serviceRoleKey)}`, limite: 60, janelaSeg: 10 * 60 }] : []),
    { chave: `responsavel-aceite:token:${tokenHash.slice(0, 16)}`, limite: 30, janelaSeg: 60 * 60 },
  ];
  if (!(await dentroDoFreio(admin, freio))) return jsonResponse({ error: MENSAGEM_FREIO }, 429);

  if (acao === "consultar") {
    const { data, error } = await admin.rpc("consultar_pedido_responsavel", { _token_hash: tokenHash });
    if (error) {
      // Falha nossa não é link expirado: a resposta não diz que o link morreu.
      console.error("responsavel-aceite: consultar", error.code);
      return jsonResponse({ error: "Não foi possível abrir o pedido agora. Tente de novo em alguns minutos." }, 500);
    }
    return jsonResponse(data);
  }

  const marcados = Array.isArray(corpo?.propositos) ? [...new Set(corpo.propositos.filter(ehProposito))] : [];
  const versoesDaPagina =
    corpo?.versoes && typeof corpo.versoes === "object" ? (corpo.versoes as Record<string, unknown>) : {};
  const versoes: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const p of marcados) {
    if (versoesDaPagina[p] !== TEXTOS_RESPONSAVEL[p].versao) {
      return jsonResponse(
        { error: "Um dos textos mudou desde que a página abriu. Recarregue a página para ler a versão nova." },
        409
      );
    }
    versoes[p] = TEXTOS_RESPONSAVEL[p].versao;
    hashes[p] = TEXTOS_RESPONSAVEL[p].sha256;
  }

  // A sessão de quem abriu o link, quando havia uma no navegador. Sem sessão
  // (o caso comum) ou com a chave pública, ninguém é identificado.
  let ator: string | null = null;
  let sessao: string | null = null;
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer && bearer !== anonKey) {
    const { data: claims } = await createClient(supabaseUrl, anonKey).auth.getClaims(bearer);
    const c = claims?.claims as { sub?: unknown; session_id?: unknown } | undefined;
    ator = typeof c?.sub === "string" ? c.sub : null;
    sessao = typeof c?.session_id === "string" ? c.session_id : null;
  }

  const { data, error } = await admin.rpc("registrar_aceite_responsavel", {
    _token_hash: tokenHash,
    _nome: typeof corpo?.nome === "string" ? corpo.nome : "",
    _propositos: marcados,
    _versoes: versoes,
    _hashes: hashes,
    _ator: ator,
    _sessao: sessao,
  });
  if (error) {
    if (error.code === "P0001") return jsonResponse({ error: error.message }, 400);
    if (error.code === "P0002") return jsonResponse({ error: "Link inválido." }, 404);
    console.error("responsavel-aceite: aceitar", error.code);
    return jsonResponse({ error: "Não foi possível registrar a resposta agora. Tente de novo em alguns minutos." }, 500);
  }
  return jsonResponse({ ok: true, autorizados: Number(data ?? 0) });
});

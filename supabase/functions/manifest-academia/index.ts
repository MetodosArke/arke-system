import { createClient } from "npm:@supabase/supabase-js@2";
import { montarManifesto, slugDoPedido, type MarcaManifesto } from "./fluxo.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";

// O manifesto do app instalado com a marca da academia. Público
// (verify_jwt = false): o navegador busca o manifesto sem sessão nenhuma, e o
// que ele devolve é o que a academia já mostra na porta — nome e ícone.
// Chega pela Vercel em `/manifest/<slug>` (vercel.json), para o manifesto
// morar no domínio do app e os caminhos dele resolverem lá.

const cabecalhos = {
  "Content-Type": "application/manifest+json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

servir("manifest-academia", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cabecalhos });
  if (req.method !== "GET") return new Response("Método não aceito.", { status: 405 });

  const slug = slugDoPedido(new URL(req.url));
  if (!slug) return new Response(JSON.stringify(montarManifesto(null)), { headers: cabecalhos });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.rpc("marca_academia", { _slug: slug });
    if (error) throw error;
    const marca = (data ?? null) as MarcaManifesto | null;
    return new Response(JSON.stringify(montarManifesto(marca)), { headers: cabecalhos });
  } catch (e) {
    // Falha nossa não vira o manifesto da ArkeFit: o app seria instalado com
    // o nome errado e ficaria assim. Sem manifesto, o navegador tenta depois.
    console.error("manifest-academia: falha ao ler a marca", resumoDoErro(e));
    return new Response(JSON.stringify({ error: "Indisponível." }), {
      status: 503,
      headers: { ...cabecalhos, "Cache-Control": "no-store" },
    });
  }
});

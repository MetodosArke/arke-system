import { createClient } from "npm:@supabase/supabase-js@2";

// Resolve arkefit.com.br/cadastro/<code> (via rewrite no vercel.json, que
// proxya direto pra cá mantendo o domínio arkefit.com.br na barra de
// endereço) para o action_link real do Supabase Auth salvo em
// links_ativacao. Sem verify_jwt: é acessado por qualquer um clicando no
// link do WhatsApp, sem sessão nenhuma.
//
// IMPORTANTE: isto NÃO redireciona automaticamente (302) pro action_link.
// O token do Supabase por trás dele é de uso único — e o próprio WhatsApp
// segue o link inteiro (inclusive redirects) pra montar a prévia da
// mensagem antes do destinatário clicar, o que "gastava" o token sozinho
// (confirmado nos logs: o primeiro GET no /auth/v1/verify vinha do
// user-agent "WhatsApp/x.x", não do navegador da pessoa). Por isso esta
// página exige um toque humano real (link/botão) antes de seguir pro
// action_link — bots de prévia buscam o HTML mas não clicam em nada.
//
// Content-Security-Policy: por padrão o gateway de Edge Functions do
// Supabase aplica "default-src 'none'; sandbox" em qualquer resposta HTML
// — isso bloqueia TODO CSS (inline style="" e bloco <style>, tanto faz) e
// foi a causa real da página aparecer sem nenhum estilo em teste real
// (confirmado inspecionando os headers da resposta). Precisa sobrescrever
// explicitamente, permitindo <style> inline; sem "sandbox" aqui, o clique
// no botão "Continuar" navega normalmente.
const CSP = "default-src 'self'; style-src 'unsafe-inline'";

const ESTILO = `
  * { box-sizing: border-box; }
  body {
    font-family: Arial, sans-serif;
    background: #faf9f7;
    color: #0d0d0d;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 24px;
    text-align: center;
  }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #55575d; margin: 0 0 20px; }
  .botao {
    display: inline-block;
    background: #c9952b;
    color: #0d0d0d;
    font-weight: bold;
    text-decoration: none;
    padding: 12px 24px;
    border-radius: 10px;
  }
`;

Deno.serve(async (req: Request) => {
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://arkefit.com.br";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const escapeHtml = (valor: string) =>
    valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const paginaExpirado = () =>
    new Response(
      `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expirado — ArkeFit</title>
<style>${ESTILO}</style>
</head>
<body>
  <div>
    <h1>Este link expirou</h1>
    <p>Peça para a academia gerar um novo convite de ativação.</p>
    <a class="botao" href="${siteUrl}/#/auth/login">Ir para o login</a>
  </div>
</body>
</html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP } }
    );

  // Falha nossa (banco fora, configuração) não é link expirado: dizer
  // "expirou" mandaria a pessoa pedir um convite novo à academia à toa — e
  // o convite antigo continuaria valendo. Mesma lição da matrícula pública,
  // que dizia "academia não encontrada" numa falha de rede.
  const paginaIndisponivel = () =>
    new Response(
      `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tente de novo — ArkeFit</title>
<style>${ESTILO}</style>
</head>
<body>
  <div>
    <h1>Não conseguimos abrir agora</h1>
    <p>O seu convite continua valendo. Tente de novo em alguns minutos, pelo mesmo link.</p>
  </div>
</body>
</html>`,
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP, "Retry-After": "60" } }
    );

  const paginaContinuar = (actionLink: string) =>
    new Response(
      `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ativar cadastro — ArkeFit</title>
<meta property="og:title" content="Ativar cadastro — ArkeFit">
<meta property="og:description" content="Toque para definir sua senha e concluir o cadastro na ArkeFit.">
<style>${ESTILO}</style>
</head>
<body>
  <div>
    <h1>Ativar meu cadastro</h1>
    <p>Toque no botão abaixo para definir sua senha e entrar na ArkeFit.</p>
    <a class="botao" href="${escapeHtml(actionLink)}">Continuar</a>
  </div>
</body>
</html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP } }
    );

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("ativar-cadastro: configuração incompleta");
    return paginaIndisponivel();
  }

  const code = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!code) {
    return paginaExpirado();
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient
      .from("links_ativacao")
      .select("action_link, expires_at")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      // Só o código: o objeto de erro pode trazer o trecho da consulta.
      console.error("ativar-cadastro: falha ao ler o link", error.code);
      return paginaIndisponivel();
    }
    if (!data || new Date(data.expires_at).getTime() < Date.now()) {
      return paginaExpirado();
    }

    return paginaContinuar(data.action_link);
  } catch (erro) {
    console.error("ativar-cadastro: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return paginaIndisponivel();
  }
});

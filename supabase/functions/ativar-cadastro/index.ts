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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link expirado — ArkeFit</title></head>
<body style="font-family:Arial,sans-serif;background:#faf9f7;color:#0d0d0d;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center;">
  <div>
    <h1 style="font-size:20px;margin:0 0 12px;">Este link expirou</h1>
    <p style="color:#55575d;margin:0 0 20px;">Peça para a academia gerar um novo convite de ativação.</p>
    <a href="${siteUrl}/#/auth/login" style="display:inline-block;background:#c9952b;color:#0d0d0d;font-weight:bold;text-decoration:none;padding:10px 20px;border-radius:10px;">Ir para o login</a>
  </div>
</body>
</html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
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
</head>
<body style="font-family:Arial,sans-serif;background:#faf9f7;color:#0d0d0d;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center;">
  <div>
    <h1 style="font-size:20px;margin:0 0 12px;">Ativar meu cadastro</h1>
    <p style="color:#55575d;margin:0 0 20px;">Toque no botão abaixo para definir sua senha e entrar na ArkeFit.</p>
    <a href="${escapeHtml(actionLink)}" style="display:inline-block;background:#c9952b;color:#0d0d0d;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:10px;">Continuar</a>
  </div>
</body>
</html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return paginaExpirado();
  }

  const code = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!code) {
    return paginaExpirado();
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient
    .from("links_ativacao")
    .select("action_link, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("Error loading link_ativacao", error);
    return paginaExpirado();
  }
  if (!data || new Date(data.expires_at).getTime() < Date.now()) {
    return paginaExpirado();
  }

  return paginaContinuar(data.action_link);
});

// Espelha a configuração de Auth do projeto antigo no novo.
//
// O que não é óbvio e por isso mora num script: o **hook de envio de e-mail**.
// O Supabase só chama a edge function `send-email` — a que manda o e-mail com
// a identidade visual do ARKE — se o hook estiver ligado nas configurações de
// Auth, e a assinatura de cada chamada é validada contra um segredo que
// precisa ser **o mesmo** em dois lugares: na configuração de Auth e no
// ambiente da função. Configurar um e esquecer o outro não dá erro na hora;
// dá e-mail que não chega, dias depois, quando um aluno pedir a senha.
//
// Por isso os dois são gravados aqui, na mesma execução, a partir do mesmo
// valor gerado. O valor não é impresso.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/auth-config.mjs [--aplicar]

import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ORIGEM = process.env.ARKE_ORIGEM ?? "jbkrxrfdrmrkyldrrdpq";
const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const aplicar = process.argv.includes("--aplicar");

const linhas = (() => {
  const a = process.env.ARKE_CHAVES;
  if (!a || !existsSync(a)) return [];
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
const porPrefixo = (p) => linhas.find((l) => l.startsWith(p));

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
if (!TOKEN) throw new Error("Sem token de acesso.");

const cabecalhos = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(caminho, metodo = "GET", corpo) {
  const r = await fetch(`https://api.supabase.com/v1/${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${metodo} ${caminho}`);
  // Algumas rotas respondem 200/201 com corpo vazio; `r.json()` cru quebraria.
  const texto = await r.text();
  return texto.trim() ? JSON.parse(texto) : null;
}

const antigo = await api(`projects/${ORIGEM}/config/auth`);

// O segredo do hook nasce aqui e vai para os dois lados.
const segredoHook = `v1,whsec_${randomBytes(24).toString("base64")}`;
const chaveResend = porPrefixo("re_");

const config = {
  site_url: antigo.site_url,
  uri_allow_list: antigo.uri_allow_list,
  password_min_length: antigo.password_min_length,
  security_update_password_require_current_password:
    antigo.security_update_password_require_current_password,
  rate_limit_email_sent: antigo.rate_limit_email_sent,
  mailer_secure_email_change_enabled: antigo.mailer_secure_email_change_enabled,
  refresh_token_rotation_enabled: antigo.refresh_token_rotation_enabled,
  security_refresh_token_reuse_interval: antigo.security_refresh_token_reuse_interval,
  jwt_exp: antigo.jwt_exp,
  hook_send_email_enabled: true,
  hook_send_email_uri: `https://${DESTINO}.supabase.co/functions/v1/send-email`,
  hook_send_email_secrets: segredoHook,
  smtp_admin_email: antigo.smtp_admin_email,
  smtp_host: antigo.smtp_host,
  smtp_port: antigo.smtp_port,
  smtp_user: antigo.smtp_user,
  smtp_sender_name: antigo.smtp_sender_name,
  ...(chaveResend ? { smtp_pass: chaveResend } : {}),
};

console.log(`origem ${ORIGEM} → destino ${DESTINO}\n`);
for (const [k, v] of Object.entries(config)) {
  const mostrar = /secret|pass/.test(k) ? "(não impresso)" : String(v);
  console.log(`  ${k.padEnd(52)} ${mostrar}`);
}
if (!chaveResend) console.log("\n  aviso: sem chave Resend no arquivo; smtp_pass não será tocado.");

if (!aplicar) {
  console.log("\nprévia: nada foi gravado. Rode com --aplicar.");
  process.exit(0);
}

await api(`projects/${DESTINO}/config/auth`, "PATCH", config);
await api(`projects/${DESTINO}/secrets`, "POST", [
  { name: "SEND_EMAIL_HOOK_SECRET", value: segredoHook },
]);

const conferencia = await api(`projects/${DESTINO}/config/auth`);
console.log("\ngravado. conferindo:");
console.log(`  hook ligado:  ${conferencia.hook_send_email_enabled}`);
console.log(`  hook aponta:  ${conferencia.hook_send_email_uri}`);
console.log(`  site_url:     ${conferencia.site_url}`);
console.log(`  senha mínima: ${conferencia.password_min_length}`);

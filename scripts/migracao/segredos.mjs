// Grava os secrets das edge functions no projeto de destino.
//
// A saída é só nome e resultado. Nenhum valor é impresso — nem os lidos do
// arquivo de chaves, nem os gerados aqui.
//
// De onde vem cada um:
//   * do arquivo de chaves (ARKE_CHAVES), identificado pelo prefixo do próprio
//     valor, porque no arquivo o rótulo e o valor ficam em linhas separadas e
//     nem todo rótulo é igual ao nome do secret;
//   * do ambiente da máquina, quando já está lá;
//   * gerado agora, quando o valor é nosso e não de terceiro.
//
// O que este script NÃO consegue trazer: os secrets que só existem dentro do
// projeto antigo. A API do Supabase devolve o SHA-256 deles, nunca o valor —
// que é o comportamento correto. Esses estão listados no fim como pendência.
//
// Uso:  ARKE_CHAVES=C:\...\chaves.txt node scripts/migracao/segredos.mjs [--aplicar]

import { readFileSync, existsSync } from "node:fs";
import { randomBytes, createECDH } from "node:crypto";

const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const aplicar = process.argv.includes("--aplicar");

const linhasDoArquivo = (() => {
  const a = process.env.ARKE_CHAVES;
  if (!a || !existsSync(a)) return [];
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();

const porPrefixo = (prefixo) => linhasDoArquivo.find((l) => l.startsWith(prefixo));

function token() {
  const t = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
  if (!t) throw new Error("Sem token de acesso (SUPABASE_ACCESS_TOKEN ou sbp_ no arquivo de chaves).");
  return t;
}
const TOKEN = token();

const hex32 = () => randomBytes(32).toString("hex");

const base64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Chave privada VAPID: uma chave P-256. A pública é derivada dela pela própria
// edge function `vapid-public-key`, então só a privada precisa ser guardada.
function vapidPrivada() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return base64url(ecdh.getPrivateKey());
}

// Formato que o Supabase usa no hook de envio de e-mail do Auth; a função
// send-email tira o prefixo antes de validar a assinatura.
const segredoDeHook = () => `v1,whsec_${randomBytes(24).toString("base64")}`;

const SEGREDOS = [
  { nome: "ASAAS_API_KEY", valor: () => porPrefixo("$aact_prod_"), fonte: "arquivo de chaves" },
  { nome: "RESEND_API_KEY", valor: () => porPrefixo("re_"), fonte: "arquivo de chaves" },
  { nome: "GEMINI_API_KEY", valor: () => process.env.GEMINI_API_KEY, fonte: "ambiente da máquina" },
  { nome: "CRON_SECRET", valor: hex32, fonte: "gerado agora" },
  { nome: "VAPID_PRIVATE_KEY", valor: vapidPrivada, fonte: "gerado agora (a pública é derivada)" },
  { nome: "SEND_EMAIL_HOOK_SECRET", valor: segredoDeHook, fonte: "gerado agora" },
];

// Só existem dentro do projeto antigo; a API devolve o hash, não o valor.
const PENDENTES = [
  ["ASAAS_WEBHOOK_SECRET", "copiar do projeto antigo (Settings → Edge Functions → Secrets)"],
  ["TURNSTILE_SECRET_KEY", "copiar do painel da Cloudflare ou do projeto antigo"],
];

const prontos = [];
const faltando = [];
for (const s of SEGREDOS) {
  const v = s.valor();
  if (v && String(v).length > 0) prontos.push({ ...s, v: String(v) });
  else faltando.push(s);
}

console.log(`destino ${DESTINO}\n`);
for (const s of prontos) console.log(`  pronto   ${s.nome.padEnd(24)} ${s.fonte}`);
for (const s of faltando) console.log(`  SEM FONTE ${s.nome.padEnd(23)} ${s.fonte}`);

if (!aplicar) {
  console.log("\nprévia: nada foi gravado. Rode com --aplicar.");
  process.exit(0);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${DESTINO}/secrets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(prontos.map((s) => ({ name: s.nome, value: s.v }))),
});
if (!r.ok) {
  // A resposta de erro pode ecoar o corpo enviado, que tem os valores.
  console.error(`\nfalhou ao gravar: HTTP ${r.status}`);
  process.exit(1);
}
console.log(`\n${prontos.length} secrets gravados.`);

if (PENDENTES.length) {
  console.log("\nfaltam, e só você consegue buscar:");
  for (const [nome, onde] of PENDENTES) console.log(`  ${nome.padEnd(24)} ${onde}`);
}

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

// Alguns valores não têm prefixo que os identifique — o token do webhook do
// Asaas é uma cadeia qualquer gerada no painel dele. Para esses, a busca é
// pelo rótulo: no arquivo de chaves o rótulo fica numa linha e o valor na
// seguinte, às vezes com uma linha de descrição no meio (`SISTEMA_ARKE`).
// Rótulos são MAIÚSCULAS_COM_UNDERSCORE, então qualquer linha nesse formato
// depois do rótulo é pulada, e a primeira que não for é o valor.
const pareceRotulo = (l) => /^[A-Z][A-Z0-9 _()-]*$/.test(l);

function porRotulo(rotulo) {
  const normalizar = (s) => s.replace(/\s+/g, "").toUpperCase();
  const i = linhasDoArquivo.findIndex((l) => normalizar(l) === normalizar(rotulo));
  if (i < 0) return undefined;
  for (let j = i + 1; j < linhasDoArquivo.length; j++) {
    if (!pareceRotulo(linhasDoArquivo[j])) return linhasDoArquivo[j];
  }
  return undefined;
}

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
  {
    nome: "ASAAS_WEBHOOK_SECRET",
    valor: () => porRotulo("ASAAS_WEBHOOK_SECRET"),
    fonte: "arquivo de chaves, por rótulo",
  },
  {
    nome: "TURNSTILE_SECRET_KEY",
    valor: () => porRotulo("TURNSTILE_SECRET_KEY"),
    fonte: "arquivo de chaves, por rótulo",
  },
];

// Onde buscar o que o script não acha sozinho. A API do Supabase devolve o
// SHA-256 dos secrets, nunca o valor, então nada disso se copia de projeto a
// projeto por aqui.
const ONDE_BUSCAR = {
  ASAAS_WEBHOOK_SECRET:
    "gerar no Asaas (Integrações → Webhooks → gerar token). O Asaas não mostra o " +
    "token de novo depois, então o mesmo valor tem que ir para o arquivo de chaves. " +
    "Gerar troca o token que o Asaas envia: fazer isso junto com a mudança da URL " +
    "do webhook, senão o projeto que ainda estiver recebendo passa a recusar os eventos.",
  TURNSTILE_SECRET_KEY: "copiar do painel da Cloudflare (Turnstile → o widget do arkefit.com.br)",
};

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

if (faltando.length) {
  console.log("\nfaltam:");
  for (const s of faltando) {
    console.log(`  ${s.nome}`);
    const onde = ONDE_BUSCAR[s.nome];
    if (onde) console.log(`     ${onde}`);
  }
}

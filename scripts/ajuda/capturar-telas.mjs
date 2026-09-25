// Imagens da Central de Ajuda, tiradas do app publicado com a academia de
// demonstração.
//
//   ARKE_CHAVES=... node scripts/ajuda/demonstracao.mjs semear
//   ARKE_CHAVES=... node scripts/ajuda/capturar-telas.mjs [nome...]
//   ARKE_CHAVES=... node scripts/ajuda/demonstracao.mjs limpar
//
// Abre cada tela com a sessão do papel certo (gestor, professor, aluna, e um
// Super Admin temporário com verificação em duas etapas para a Visão Master,
// apagado no fim) e grava em public/ajuda/telas/<nome>.jpg. Com nomes na linha
// de comando, tira só essas. Os dados são todos fictícios; a Visão Master
// mostra o que houver na plataforma, e por isso as telas dela recortam só o
// alto da página.
import { readFileSync, mkdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");
const SAIDA = join(RAIZ, "public", "ajuda", "telas");
const SITE = process.env.ARKE_SITE ?? "https://www.arkefit.com.br";
const PROJETO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const URL = `https://${PROJETO}.supabase.co`;
const { chromium } = createRequire(join(RAIZ, "package.json"))("@playwright/test");

function porPrefixo(prefixo) {
  const a = process.env.ARKE_CHAVES;
  if (!a) return null;
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(prefixo)) ?? null;
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const SERVICE = chaves.find((k) => k.name === "service_role").api_key;
const ANON = chaves.find((k) => k.name === "anon").api_key;
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 500));
  return t.trim() ? JSON.parse(t) : null;
};
const admin = (caminho, init = {}) =>
  fetch(`${URL}/auth/v1${caminho}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

const { sessoes } = JSON.parse(readFileSync(join(AQUI, ".sessoes.json"), "utf8"));

// ——— Super Admin temporário, com o fator TOTP cadastrado e verificado aqui ———
function base32(s) {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alfabeto.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(segredo) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", base32(segredo)).update(contador).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
async function superAdminTemporario() {
  const email = `superadmin.ajuda.${Date.now()}@demo.arkefit.com.br`;
  const u = await (await admin("/admin/users", { method: "POST", body: JSON.stringify({ email, password: `Tmp.${Math.random().toString(36).slice(2)}#9Aa`, email_confirm: true, user_metadata: { full_name: "Suporte ArkeFit" } }) })).json();
  await sql(`insert into public.user_roles (user_id, role) values ('${u.id}', 'superadmin')`);
  const g = await (await admin("/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const aal1 = await (await fetch(`${URL}/auth/v1/verify`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: g?.properties?.hashed_token ?? g?.hashed_token }) })).json();
  const h = { apikey: ANON, Authorization: `Bearer ${aal1.access_token}`, "Content-Type": "application/json" };
  const fator = await (await fetch(`${URL}/auth/v1/factors`, { method: "POST", headers: h, body: JSON.stringify({ factor_type: "totp", friendly_name: "ajuda" }) })).json();
  const desafio = await (await fetch(`${URL}/auth/v1/factors/${fator.id}/challenge`, { method: "POST", headers: h, body: "{}" })).json();
  const aal2 = await (await fetch(`${URL}/auth/v1/factors/${fator.id}/verify`, { method: "POST", headers: h, body: JSON.stringify({ challenge_id: desafio.id, code: totp(fator.totp.secret) }) })).json();
  if (!aal2.access_token) throw new Error("verificação em duas etapas falhou");
  return { sessao: aal2, apagar: () => admin(`/admin/users/${u.id}`, { method: "DELETE" }) };
}

const comoSessao = (v) => ({ access_token: v.access_token, refresh_token: v.refresh_token, expires_in: v.expires_in, expires_at: Math.floor(Date.now() / 1000) + v.expires_in, token_type: "bearer", user: v.user });

// ——— As telas ———
const DESKTOP = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };
const TELAS = [
  { nome: "painel-home", papel: "gestor", rota: "/admin/dashboard" },
  { nome: "fila", papel: "gestor", rota: "/admin" },
  { nome: "alunos", papel: "gestor", rota: "/admin/alunos" },
  { nome: "ficha", papel: "gestor", rota: "/admin/alunos", depois: async (p) => { await p.getByText("Marina Costa", { exact: true }).first().click(); await p.waitForTimeout(3500); } },
  { nome: "ficha-plano", papel: "gestor", rota: "/admin/alunos", depois: async (p) => { await p.getByText("Marina Costa", { exact: true }).first().click(); await p.waitForTimeout(3500); await p.getByText("Plano da Academia", { exact: true }).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(800); } },
  { nome: "importar", papel: "gestor", rota: "/admin/alunos/importar" },
  { nome: "treinos", papel: "professor", rota: "/admin/treinos" },
  { nome: "dietas", papel: "nutricionista", rota: "/admin/dietas" },
  { nome: "mensagens", papel: "gestor", rota: "/admin/mensagens", depois: async (p) => { await p.getByText("Pedro Almeida").first().click().catch(() => {}); await p.waitForTimeout(2500); } },
  { nome: "checkin-qr", papel: "recepcao", rota: "/admin/checkin-qr" },
  { nome: "funil", papel: "gestor", rota: "/admin/funil" },
  { nome: "comunicados", papel: "gestor", rota: "/admin/comunicados" },
  { nome: "financeiro", papel: "gestor", rota: "/admin/financeiro" },
  { nome: "onboarding", papel: "gestor", rota: "/admin/onboarding" },
  { nome: "organizacao", papel: "gestor", rota: "/admin/organizacao", depois: async (p) => { await p.getByRole("tab", { name: "Planos da Academia" }).click().catch(() => {}); await p.waitForTimeout(1500); } },
  { nome: "equipe", papel: "gestor", rota: "/admin/equipe" },
  { nome: "gestao360", papel: "gestor", rota: "/admin/gestao-360" },
  { nome: "retencao", papel: "gestor", rota: "/admin/retencao" },
  // O aluno do Free (Pedro) é o caso comum; a Marina, do Método, abre no
  // acolhimento M.A.P.A.® enquanto não responde a anamnese.
  { nome: "app-home", papel: "pedro", rota: "/app", tela: CELULAR },
  { nome: "app-acolhimento", papel: "marina", rota: "/app", tela: CELULAR },
  { nome: "app-treino", papel: "pedro", rota: "/app/treinos", tela: CELULAR },
  { nome: "app-dieta", papel: "pedro", rota: "/app/dieta", tela: CELULAR },
  { nome: "app-evolucao", papel: "pedro", rota: "/app/evolucao", tela: CELULAR },
  { nome: "app-pagamentos", papel: "pedro", rota: "/app/perfil", tela: CELULAR, depois: async (p) => { await p.getByText("Pagamentos da academia").first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(800); } },
  { nome: "vm-visao-geral", papel: "superadmin", rota: "/superadmin" },
  { nome: "vm-vigia", papel: "superadmin", rota: "/superadmin/vigia" },
  { nome: "vm-mentoria", papel: "superadmin", rota: "/superadmin/mentoria", depois: async (p) => { await p.getByRole("tab", { name: "Operação" }).click().catch(() => {}); await p.waitForTimeout(2500); } },
];

const pedidas = process.argv.slice(2);
const aTirar = pedidas.length ? TELAS.filter((t) => pedidas.includes(t.nome)) : TELAS;
mkdirSync(SAIDA, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const sa = aTirar.some((t) => t.papel === "superadmin") ? await superAdminTemporario() : null;
let falhas = 0;
try {
  for (const t of aTirar) {
    const sessao = t.papel === "superadmin" ? sa.sessao : sessoes[t.papel];
    const ctx = await browser.newContext({ viewport: t.tela ?? DESKTOP, deviceScaleFactor: t.tela === CELULAR ? 2 : 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo", colorScheme: "light" });
    await ctx.addInitScript(([k, v]) => {
      try {
        localStorage.setItem(k, v);
        localStorage.setItem("gym-theme", "light");
        localStorage.setItem("arkefit_manter_conectado", "1");
      } catch {
        // sem storage: a tela abre deslogada e o erro aparece abaixo
      }
    }, [`sb-${PROJETO}-auth-token`, JSON.stringify(comoSessao(sessao))]);
    const page = await ctx.newPage();
    try {
      await page.goto(`${SITE}/#${t.rota}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (t.depois) await t.depois(page);
      const caminho = join(SAIDA, `${t.nome}.jpg`);
      await page.screenshot({ path: caminho, type: "jpeg", quality: 78 });
      const url = page.url();
      const ok = url.includes(t.rota === "/app" ? "/app" : t.rota) && !url.includes("/auth/login");
      console.log(`${ok ? "ok    " : "CONFIRA"} ${t.nome}${ok ? "" : `  (${url})`}`);
      if (!ok) falhas++;
    } catch (e) {
      falhas++;
      console.log(`FALHOU ${t.nome}: ${String(e).slice(0, 160)}`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  if (sa) await sa.apagar();
}
console.log(falhas ? `\n${falhas} tela(s) para conferir` : "\ntodas as telas gravadas");

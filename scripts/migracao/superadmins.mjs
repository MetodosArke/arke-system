// Cria os Super Admins da ArkeFit no projeto de destino.
//
// Sem isto, o projeto novo sobe sem ninguém que consiga administrá-lo: a Visão
// Master exige o papel `superadmin`, e o papel mora em `public.user_roles`, que
// nenhuma tela concede a si mesma — de propósito.
//
// Cada conta nasce com o e-mail já confirmado e uma senha aleatória que não é
// impressa nem guardada. O acesso se faz pelo "esqueci minha senha" do próprio
// app, que é o caminho que o dono da conta controla. Assim nenhuma senha
// trafega por aqui.
//
// Idempotente: se o e-mail já existe no destino, o script só confere os papéis.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/superadmins.mjs [--aplicar]

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
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || linhas.find((l) => l.startsWith("sbp_"));
if (!TOKEN) throw new Error("Sem token de acesso.");

const gerencia = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(caminho, metodo = "GET", corpo) {
  const r = await fetch(`https://api.supabase.com/v1/${caminho}`, {
    method: metodo,
    headers: gerencia,
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${metodo} ${caminho}: ${t.slice(0, 300)}`);
  return t.trim() ? JSON.parse(t) : null;
}

const sql = (ref, q) => api(`projects/${ref}/database/query`, "POST", { query: q });

// Quem é Super Admin hoje, lido do projeto de origem — a lista não é digitada
// à mão para não esquecer ninguém nem inventar ninguém.
const donos = await sql(
  ORIGEM,
  `select u.email, array_agg(distinct ur.role::text order by ur.role::text) as papeis
     from auth.users u
     join public.user_roles ur on ur.user_id = u.id
    where ur.role::text in ('superadmin','admin_arke')
    group by u.email
    order by u.email`,
);

console.log(`origem ${ORIGEM} → destino ${DESTINO}\n`);
for (const d of donos) console.log(`  ${d.email}  ${d.papeis.join(", ")}`);

if (!aplicar) {
  console.log("\nprévia: nada foi criado. Rode com --aplicar.");
  process.exit(0);
}

const chaves = await api(`projects/${DESTINO}/api-keys?reveal=true`);
const servico = chaves.find((k) => k.name === "service_role" || k.type === "secret")?.api_key;
if (!servico) throw new Error("Não consegui obter a chave de serviço do destino.");

const admin = {
  apikey: servico,
  Authorization: `Bearer ${servico}`,
  "Content-Type": "application/json",
};

for (const d of donos) {
  const existente = await sql(
    DESTINO,
    `select id::text from auth.users where email = '${d.email.replace(/'/g, "''")}' limit 1`,
  );
  let id = existente[0]?.id;

  if (!id) {
    const r = await fetch(`https://${DESTINO}.supabase.co/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: d.email,
        // Aleatória e descartada: o dono entra pelo "esqueci minha senha".
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
      }),
    });
    const t = await r.text();
    if (!r.ok) {
      console.error(`  FALHA ao criar ${d.email}: HTTP ${r.status} ${t.slice(0, 200)}`);
      continue;
    }
    id = JSON.parse(t).id;
    console.log(`  criado   ${d.email}`);
  } else {
    console.log(`  já havia ${d.email}`);
  }

  const papeis = d.papeis.map((p) => `('${id}', '${p}'::public.app_role)`).join(", ");
  await sql(
    DESTINO,
    `insert into public.user_roles (user_id, role) values ${papeis}
     on conflict do nothing`,
  );
}

const conferencia = await sql(
  DESTINO,
  `select u.email, array_agg(distinct ur.role::text order by ur.role::text) as papeis
     from auth.users u join public.user_roles ur on ur.user_id = u.id
    group by u.email order by u.email`,
);
console.log("\nno destino:");
for (const c of conferencia) console.log(`  ${c.email}  ${c.papeis.join(", ")}`);

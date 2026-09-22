// Cria (ou recria) a conta de aluno que o teste de ponta a ponta usa, e grava
// a senha direto nos secrets do GitHub.
//
// Por que existe: `jornada-aluno.spec.ts` faz login de verdade, no app
// publicado, com uma conta que precisa existir no banco de produção. Sem ela o
// teste falha em todo deploy — e a conta do projeto antigo não atravessou a
// migração, porque os dados de academia não atravessaram.
//
// A senha é gerada aqui e vai direto para o secret do GitHub pelo `gh`, sem
// passar por tela nem por arquivo. Ninguém precisa saber qual é: quem a usa é
// o workflow. Se for preciso entrar na conta à mão um dia, o caminho é o
// "esqueci minha senha" do próprio app.
//
// A matrícula pública não serve para isto desde que o Turnstile foi ligado: o
// captcha barra chamada por script, que é exatamente o que ele existe para
// fazer. Então a conta é montada aqui pelos mesmos passos que a ficha do aluno
// daria — usuário no Auth, vínculo na organização e registro de aluno.
//
// Uso:  ARKE_CHAVES=... node scripts/migracao/conta-e2e.mjs [--aplicar]

import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DESTINO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const SLUG = process.env.ARKE_SLUG_HOMOLOGACAO ?? "homologacao";
const EMAIL = process.env.ARKE_EMAIL_E2E ?? "e2e-jornada@arkefit.com.br";
const REPO = process.env.ARKE_REPO ?? "MetodosArke/arke-system";
const aplicar = process.argv.includes("--aplicar");

// Roda a jornada autenticada logo depois de criar a conta, passando a senha
// pelo ambiente do processo filho.
//
// Sem isto não há como rodar esse teste na mão: a senha é gerada aqui e vai
// direto para o secret do GitHub, então ninguém a conhece para digitar num
// `.env`. Escrevê-la em arquivo só para poder testar seria trocar o cuidado
// todo por conveniência — o ambiente do filho morre com ele.
const rodarE2e = process.argv.includes("--rodar-e2e");

const linhas = (() => {
  const a = process.env.ARKE_CHAVES;
  if (!a || !existsSync(a)) return [];
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || linhas.find((l) => l.startsWith("sbp_"));
if (!TOKEN) throw new Error("Sem token de acesso.");

async function api(caminho, metodo = "GET", corpo) {
  const r = await fetch(`https://api.supabase.com/v1/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${metodo} ${caminho}: ${t.slice(0, 300)}`);
  return t.trim() ? JSON.parse(t) : null;
}
const sql = (q) => api(`projects/${DESTINO}/database/query`, "POST", { query: q });
const aspas = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const org = await sql(
  `select id::text, nome, status from public.organizations where slug = ${aspas(SLUG)} limit 1`,
);
if (!org.length) throw new Error(`Organização com slug "${SLUG}" não existe em ${DESTINO}.`);

console.log(`destino      ${DESTINO}`);
console.log(`organização  ${org[0].nome} (${SLUG}, ${org[0].status})`);
console.log(`conta        ${EMAIL}`);
console.log(`secrets em   ${REPO}\n`);

if (!aplicar) {
  console.log("prévia: nada foi criado. Rode com --aplicar.");
} else {
  const chaves = await api(`projects/${DESTINO}/api-keys?reveal=true`);
  const servico = chaves.find((k) => k.name === "service_role")?.api_key;
  if (!servico) throw new Error("Não consegui obter a chave de serviço do destino.");
  const admin = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

  // Senha forte o bastante para a política do projeto (mínimo 8) e que nunca é
  // impressa. `-` e `_` do base64url evitam dor de cabeça com aspas no shell.
  const senha = `E2e.${randomBytes(18).toString("base64url")}`;

  const existente = await sql(`select id::text from auth.users where email = ${aspas(EMAIL)} limit 1`);
  let userId = existente[0]?.id;

  if (userId) {
    const r = await fetch(`https://${DESTINO}.supabase.co/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: admin,
      body: JSON.stringify({ password: senha, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`falha ao trocar a senha: HTTP ${r.status}`);
    console.log("  conta já existia; senha trocada");
  } else {
    const r = await fetch(`https://${DESTINO}.supabase.co/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email: EMAIL,
        password: senha,
        email_confirm: true,
        user_metadata: { full_name: "Aluno E2E" },
      }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`falha ao criar a conta: HTTP ${r.status} ${t.slice(0, 200)}`);
    userId = JSON.parse(t).id;
    console.log("  conta criada");
  }

  // Vínculo e registro de aluno. Os valores que faltam vêm dos defaults da
  // tabela: plano Free (`sem_adesao`) e situação `em_dia`, que é o que o teste
  // precisa para passar pelos gates e cair na home.
  await sql(`
    insert into public.organization_members (organization_id, user_id, role, status)
    values (${aspas(org[0].id)}, ${aspas(userId)}, 'aluno', 'active')
    on conflict (organization_id, user_id) do update set role = 'aluno', status = 'active';

    insert into public.alunos (organization_id, user_id)
    values (${aspas(org[0].id)}, ${aspas(userId)})
    on conflict do nothing;
  `);
  console.log("  vínculo e registro de aluno prontos");

  // `gh secret set` lê o valor da entrada padrão: ele não aparece na linha de
  // comando (e portanto nem no histórico do shell) nem na saída.
  for (const [nome, valor] of [["E2E_EMAIL", EMAIL], ["E2E_SENHA", senha]]) {
    execFileSync("gh", ["secret", "set", nome, "--repo", REPO], { input: valor, stdio: ["pipe", "ignore", "inherit"] });
    console.log(`  secret ${nome} gravado no GitHub`);
  }

  // Prova que a conta entra: um login de verdade, com a senha recém-gravada.
  const login = await fetch(`https://${DESTINO}.supabase.co/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: servico, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: senha }),
  });
  console.log(
    login.ok
      ? "\n  login conferido: a conta entra com a senha que está no secret"
      : `\n  ATENÇÃO: o login falhou (HTTP ${login.status}) — o teste E2E vai falhar também`,
  );

  if (rodarE2e) {
    console.log("\nrodando a jornada do aluno contra o app publicado:\n");
    try {
      // O CLI do Playwright é chamado pelo próprio node, não por `npx`: no
      // Windows o `npx.cmd` precisa de shell e, sem ele, a falha vem vazia —
      // o que esconde justamente a saída do teste.
      execFileSync(
        process.execPath,
        ["node_modules/@playwright/test/cli.js", "test", "e2e/jornada-aluno.spec.ts"],
        { stdio: "inherit", cwd: RAIZ, env: { ...process.env, E2E_EMAIL: EMAIL, E2E_SENHA: senha } },
      );
    } catch {
      console.error("\n  a jornada falhou — veja a saída acima.");
      process.exitCode = 1;
    }
  }
}

const conferencia = await sql(`
  select u.email, a.situacao_academia::text as situacao, a.metodo_arke_status::text as metodo,
         o.slug, m.role::text as papel, m.status as vinculo
    from auth.users u
    join public.alunos a on a.user_id = u.id
    join public.organizations o on o.id = a.organization_id
    join public.organization_members m on m.user_id = u.id and m.organization_id = o.id
   where u.email = ${aspas(EMAIL)}`);
console.log("\nestado da conta:");
console.log(conferencia.length ? conferencia[0] : "  (ainda não existe)");

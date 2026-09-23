// Prepara a academia de homologação para exercitar a CORRENTE INTEIRA de
// cobrança — aluno → edge function → Asaas → webhook → banco → gate de
// bloqueio — sem tocar em dinheiro real.
//
// Isto só é possível desde 23/09/2026, quando o alvo do gateway passou a
// seguir o status da organização (`_shared/asaas.ts`): organização em trial é
// homologação e fala com o **sandbox** do Asaas. Antes, exercitar a corrente
// exigiria criar cobrança de verdade na conta de verdade — e, pior, criar no
// Asaas um cliente com um CPF sintético que pode pertencer a alguém.
//
// O que o script faz:
//   1. abre uma subconta no sandbox para a homologação receber o split
//      (o Asaas recusa split para a própria carteira, então precisa ser outra);
//   2. cadastra N alunos com CPF gerado — válido pelo dígito verificador e de
//      ninguém, porque é sintético;
//   3. deixa cada um com adesão ao Método, que é o que autoriza a cobrança.
//
// A emissão em si é feita pela edge function publicada, para o teste passar
// por todos os portões reais. Ver `--emitir`.
//
//   ARKE_CHAVES=... node scripts/homologacao-cobranca.mjs --preparar
//   ARKE_CHAVES=... node scripts/homologacao-cobranca.mjs --emitir

import { readFileSync, existsSync } from "node:fs";
import { criarOuAdotarSubconta, montarSubconta } from "../supabase/functions/asaas-conta-academia/fluxo.ts";

const PROJETO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const SLUG = process.env.ARKE_SLUG_HOMOLOGACAO ?? "homologacao";
const QUANTOS = Number(process.env.ARKE_ALUNOS ?? 3);
const API_SANDBOX = "https://api-sandbox.asaas.com/v3";

const linhas = (() => {
  const a = process.env.ARKE_CHAVES;
  if (!a || !existsSync(a)) return [];
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
})();
const porPrefixo = (p) => linhas.find((l) => l.startsWith(p));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
const CHAVE_SANDBOX = process.env.ASAAS_SANDBOX_KEY || porPrefixo("$aact_hmlg_");
if (!TOKEN) throw new Error("Sem token de acesso (sbp_).");
if (!CHAVE_SANDBOX?.startsWith("$aact_hmlg_")) throw new Error("Sem chave de sandbox ($aact_hmlg_).");

const H_SANDBOX = { "Content-Type": "application/json", access_token: CHAVE_SANDBOX, "User-Agent": "arke-homologacao" };

async function api(caminho, metodo = "GET", corpo) {
  const r = await fetch(`https://api.supabase.com/v1/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${metodo} ${caminho}: ${t.slice(0, 400)}`);
  return t.trim() ? JSON.parse(t) : null;
}
const sql = (q) => api(`projects/${PROJETO}/database/query`, "POST", { query: q });
const aspas = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** CPF sintético válido pelo dígito verificador. Não é de ninguém. */
function gerarCpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (let r = 0; r < 2; r++) {
    const peso = n.length + 1;
    const soma = n.reduce((s, d, i) => s + d * (peso - i), 0);
    const resto = (soma * 10) % 11;
    n.push(resto >= 10 ? 0 : resto);
  }
  // Sequência repetida passa no módulo 11 por acidente e o projeto a recusa.
  return /^(\d)\1{10}$/.test(n.join("")) ? gerarCpf() : n.join("");
}

function gerarCnpj() {
  const base = Array.from({ length: 12 }, (_, i) => (i >= 8 ? [0, 0, 0, 1][i - 8] : Math.floor(Math.random() * 10)));
  const dv = (nums, pesos) => {
    const r = nums.reduce((s, d, i) => s + d * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  base.push(dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  base.push(dv(base, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return base.join("");
}

const modo = process.argv.includes("--emitir") ? "emitir" : "preparar";

const [org] = await sql(
  `select id::text, nome, status, coalesce(asaas_wallet_id,'') as wallet from public.organizations where slug = ${aspas(SLUG)}`,
);
if (!org) throw new Error(`Organização "${SLUG}" não existe.`);
if (org.status !== "trial") {
  throw new Error(`A organização precisa estar em trial para falar com o sandbox. Está em "${org.status}".`);
}
console.log(`academia: ${org.nome} (${org.status})`);

if (modo === "preparar") {
  // --- 1. Carteira para receber o split -------------------------------------
  if (org.wallet) {
    console.log(`  carteira já configurada`);
  } else {
    const sufixo = Math.random().toString(36).slice(2, 8);
    const montado = montarSubconta({
      nome: `${org.nome} ${sufixo}`,
      razao_social: `${org.nome} ${sufixo} LTDA`,
      cnpj_cpf: gerarCnpj(),
      email_contato: `homologacao+${sufixo}@arkefit.com.br`,
      telefone: "11987654321",
      cep: "01310-100",
      logradouro: "Avenida Paulista",
      numero: "1000",
      complemento: null,
      bairro: "Bela Vista",
      tipo_empresa: "LIMITED",
      faturamento_mensal: 30000,
    });
    if (!montado.ok) throw new Error(`payload da subconta incompleto: ${montado.faltando.join(", ")}`);
    const conta = await criarOuAdotarSubconta(API_SANDBOX, CHAVE_SANDBOX, montado.payload);
    if (!conta.ok) throw new Error(`subconta: ${conta.erro}`);
    await sql(`update public.organizations set asaas_wallet_id = ${aspas(conta.walletId)} where id = ${aspas(org.id)}`);
    console.log(`  carteira da homologação criada no sandbox`);
  }

  // --- 2. Alunos com CPF ----------------------------------------------------
  const chaves = await api(`projects/${PROJETO}/api-keys?reveal=true`);
  const servico = chaves.find((k) => k.name === "service_role")?.api_key;
  if (!servico) throw new Error("Não consegui obter a chave de serviço.");
  const admin = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

  for (let i = 1; i <= QUANTOS; i++) {
    const email = `aluno.teste${i}.${Date.now()}@arkefit.com.br`;
    const cpf = gerarCpf();
    const r = await fetch(`https://${PROJETO}.supabase.co/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email,
        password: `Teste.${Math.random().toString(36).slice(2, 12)}`,
        email_confirm: true,
        user_metadata: { full_name: `Aluno Teste ${i}` },
      }),
    });
    if (!r.ok) {
      console.error(`  aluno ${i}: falha ao criar (HTTP ${r.status})`);
      continue;
    }
    const userId = (await r.json()).id;
    await sql(`
      update public.profiles set cpf = ${aspas(cpf)}, full_name = ${aspas(`Aluno Teste ${i}`)} where user_id = ${aspas(userId)};
      insert into public.organization_members (organization_id, user_id, role, status)
        values (${aspas(org.id)}, ${aspas(userId)}, 'aluno', 'active')
        on conflict (organization_id, user_id) do nothing;
      insert into public.alunos (organization_id, user_id, nivel_atacado, metodo_arke_status)
        values (${aspas(org.id)}, ${aspas(userId)}, 'integrado', 'ativo')
        on conflict do nothing;
    `);
    console.log(`  aluno ${i}: criado com CPF e adesão ao Método`);
  }
}


if (modo === "emitir") {
  // A emissão passa pela edge function PUBLICADA, autenticada como um gestor
  // de verdade. Chamar com a service role bypassaria o RLS e o teste deixaria
  // de provar justamente os portões que mais importam: quem pode cobrar quem.
  //
  // O gestor é temporário e criado aqui, com senha gerada em memória que não é
  // impressa nem guardada; some no fim. Usar o gestor real exigiria a senha
  // dele, que só ele tem.
  const chaves = await api(`projects/${PROJETO}/api-keys?reveal=true`);
  const servico = chaves.find((k) => k.name === "service_role")?.api_key;
  const anon = chaves.find((k) => k.name === "anon")?.api_key;
  if (!servico || !anon) throw new Error("Não consegui obter as chaves do projeto.");
  const admin = { apikey: servico, Authorization: `Bearer ${servico}`, "Content-Type": "application/json" };

  // Execução anterior interrompida deixa o gestor de teste para trás. Varrer
  // antes evita acumular conta com poder de gestor na homologação.
  const antigos = await sql(
    `select id::text from auth.users where email like 'gestor.teste.%@arkefit.com.br'`,
  );
  for (const u of antigos) {
    await sql(`delete from public.organization_members where user_id = ${aspas(u.id)}`);
    await fetch(`https://${PROJETO}.supabase.co/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: admin });
  }
  if (antigos.length) console.log(`  ${antigos.length} gestor(es) de teste de execução anterior removido(s)`);

  const emailGestor = `gestor.teste.${Date.now()}@arkefit.com.br`;
  const senhaGestor = `G.${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 8)}`;
  const criado = await fetch(`https://${PROJETO}.supabase.co/auth/v1/admin/users`, {
    method: "POST", headers: admin,
    body: JSON.stringify({ email: emailGestor, password: senhaGestor, email_confirm: true }),
  });
  if (!criado.ok) throw new Error(`falha ao criar gestor de teste: HTTP ${criado.status}`);
  const gestorId = (await criado.json()).id;
  await sql(`insert into public.organization_members (organization_id, user_id, role, status)
             values (${aspas(org.id)}, ${aspas(gestorId)}, 'gestor', 'active')
             on conflict (organization_id, user_id) do update set role='gestor', status='active'`);

  const login = await fetch(`https://${PROJETO}.supabase.co/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailGestor, password: senhaGestor }),
  });
  if (!login.ok) throw new Error(`falha no login do gestor de teste: HTTP ${login.status}`);
  const jwt = (await login.json()).access_token;
  console.log("  gestor de teste autenticado");

  const paraCobrar = await sql(`
    select a.id::text as aluno_id, coalesce(p.full_name, '?') as nome
      from public.alunos a
      left join public.profiles p on p.user_id = a.user_id
      left join public.aluno_assinaturas s on s.aluno_id = a.id
     where a.organization_id = ${aspas(org.id)}
       and a.metodo_arke_status = 'ativo'
       and s.asaas_subscription_id is null
     order by p.full_name`);

  console.log(`\nemitindo ${paraCobrar.length} assinatura(s) pela edge function:`);
  for (const alvo of paraCobrar) {
    const r = await fetch(`https://${PROJETO}.supabase.co/functions/v1/asaas-create-subscription`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ aluno_id: alvo.aluno_id, valor_cobrado: 119 }),
    });
    const corpo = await r.json().catch(() => ({}));
    console.log(`  ${alvo.nome.padEnd(18)} ${r.ok ? "ok " + (corpo.asaas_subscription_id ?? "") : "FALHOU " + (corpo.error ?? r.status)}`);
  }

  // Idempotência: a segunda chamada tem de recusar, não duplicar.
  if (paraCobrar[0]) {
    const r2 = await fetch(`https://${PROJETO}.supabase.co/functions/v1/asaas-create-subscription`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ aluno_id: paraCobrar[0].aluno_id, valor_cobrado: 119 }),
    });
    const c2 = await r2.json().catch(() => ({}));
    console.log(`  segunda chamada no mesmo aluno: ${r2.status} ${c2.error ?? "(criou de novo — DEFEITO)"}`);
  }

  await sql(`delete from public.organization_members where user_id = ${aspas(gestorId)}`);
  await fetch(`https://${PROJETO}.supabase.co/auth/v1/admin/users/${gestorId}`, { method: "DELETE", headers: admin });
  console.log("  gestor de teste removido");
}

// --- Estado -----------------------------------------------------------------
const alunos = await sql(`
  select coalesce(p.full_name,'?') as nome,
         coalesce(p.cpf,'(sem)') as cpf,
         a.metodo_arke_status::text as metodo,
         a.nivel_atacado::text as nivel,
         coalesce(s.status::text,'(sem assinatura)') as assinatura,
         coalesce(s.asaas_subscription_id,'—') as asaas_id
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
    left join public.aluno_assinaturas s on s.aluno_id = a.id
   where a.organization_id = ${aspas(org.id)}
   order by p.full_name`);
console.log("\nalunos da homologação:");
for (const a of alunos) {
  console.log(`  ${a.nome.padEnd(18)} cpf=${a.cpf} metodo=${a.metodo} nivel=${a.nivel} assinatura=${a.assinatura} ${a.asaas_id}`);
}

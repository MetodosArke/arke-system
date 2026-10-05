// Academia de demonstração, para apresentar o ArkeFit a uma academia.
//
//   ARKE_CHAVES=... node scripts/demonstracao/academia.mjs semear
//   ARKE_CHAVES=... node scripts/demonstracao/academia.mjs recriar   (apaga e semeia de novo, com as datas de hoje)
//   ARKE_CHAVES=... node scripts/demonstracao/academia.mjs limpar
//
// Cria a "Ponto Alto Academia", inteira e em uso: gestão, recepção, quatro
// professores e nutricionista; 180 alunos com até um ano e meio de casa,
// mensalidades dos últimos meses (a maior parte paga, algumas em atraso),
// treinos publicados e registrados, dietas, avaliações físicas, check-ins,
// fila de atendimento com casos abertos e resolvidos, mensagens, funil de
// vendas, comunicados, despesas do mês e um desafio.
//
// É uma academia FICTÍCIA (`organizations.ficticia`): fica fora do MRR, da
// receita e das contagens da Visão Master, da conferência financeira do Vigia e
// do resumo semanal por e-mail. Está em trial, que é o status de homologação:
// não é cobrada e só fala com o sandbox do Asaas. Os nomes, CPFs e telefones
// são inventados; os CPFs fecham o dígito verificador e não são de ninguém.
//
// As contas usam o domínio demonstracao.arkefit.com.br, que não recebe
// e-mail. Os logins para a apresentação (gestão, recepção, professor,
// nutricionista e dois alunos) têm uma senha só, gerada aqui e guardada FORA
// do repositório, no arquivo de ARKE_DEMO_ACESSOS (padrão:
// ~/arkefit-demonstracao.txt). `recriar` reaproveita a senha do arquivo.
//
// As datas são relativas ao dia em que se semeia: para a academia parecer
// viva numa apresentação, rode `recriar` na véspera.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const PROJETO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const URL_PROJETO = `https://${PROJETO}.supabase.co`;
const SLUG = "ponto-alto";
const NOME = "Ponto Alto Academia";
const DOMINIO = "demonstracao.arkefit.com.br";
const ARQUIVO_ACESSOS = process.env.ARKE_DEMO_ACESSOS ?? join(homedir(), "arkefit-demonstracao.txt");
const TOTAL_ALUNOS = 180;

function porPrefixo(prefixo) {
  const a = process.env.ARKE_CHAVES;
  if (!a) return null;
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(prefixo)) ?? null;
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
if (!TOKEN) throw new Error("Sem token de acesso (sbp_).");

async function sql(consulta) {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: consulta }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    const t = await r.text();
    if (r.ok) return t.trim() ? JSON.parse(t) : null;
    if (tentativa < 3 && (r.status === 0 || r.status >= 500 || r.status === 429)) {
      await new Promise((ok) => setTimeout(ok, 3000 * (tentativa + 1)));
      continue;
    }
    throw new Error(t.slice(0, 900));
  }
}
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);

const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const SERVICE = chaves.find((k) => k.name === "service_role").api_key;
const admin = (caminho, init = {}) =>
  fetch(`${URL_PROJETO}/auth/v1${caminho}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

// ── Sorteio com semente fixa: a mesma academia a cada execução ────────────
let estado = 20261005;
function sorteio() {
  estado = (estado + 0x6d2b79f5) | 0;
  let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + Math.floor(sorteio() * (b - a + 1));
const um = (lista) => lista[Math.floor(sorteio() * lista.length)];
const chance = (p) => sorteio() < p;

// CPF válido pelo dígito verificador, a partir de uma semente: sintético.
function cpf(semente) {
  const n = String(200000000 + ((semente * 7919 + 1301) % 699999999)).slice(0, 9).split("").map(Number);
  const dv = (base) => {
    const s = base.reduce((a, d, i) => a + d * (base.length + 1 - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join("");
}
function cnpj(semente) {
  const n = String(30000000 + ((semente * 104729) % 59999999)).slice(0, 8).split("").map(Number).concat([0, 0, 0, 1]);
  const dv = (base, pesos) => {
    const s = base.reduce((a, d, i) => a + d * pesos[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  n.push(dv(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  n.push(dv(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return n.join("");
}
const telefone = (i) => `(11) 9${String(7100 + (i % 2800)).padStart(4, "0")}-${String(1000 + ((i * 37) % 8999)).padStart(4, "0")}`;

const NOMES_F = ["Ana", "Beatriz", "Camila", "Daniela", "Eduarda", "Fernanda", "Gabriela", "Helena", "Isabela", "Juliana", "Larissa", "Mariana", "Natália", "Patrícia", "Rafaela", "Sofia", "Tatiane", "Vanessa", "Yasmin", "Aline", "Bruna", "Carolina", "Débora", "Elisa", "Flávia", "Giovana", "Heloísa", "Jéssica", "Letícia", "Luana", "Manuela", "Renata", "Simone", "Talita", "Viviane"];
const NOMES_M = ["André", "Bruno", "Caio", "Daniel", "Eduardo", "Felipe", "Gabriel", "Henrique", "Igor", "João", "Leonardo", "Marcelo", "Nicolas", "Otávio", "Pedro", "Rafael", "Samuel", "Thiago", "Vinícius", "Arthur", "Breno", "Cauã", "Diego", "Enzo", "Fábio", "Gustavo", "Hugo", "Lucas", "Matheus", "Murilo", "Renan", "Sérgio", "Túlio", "Victor", "Wagner"];
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos", "Gonçalves", "Santana", "Teixeira", "Araújo", "Castro", "Pinto", "Correia", "Monteiro"];
const OBJETIVOS = ["Emagrecimento", "Hipertrofia", "Condicionamento físico", "Saúde e disposição", "Fortalecer a lombar", "Voltar a treinar", "Correr 10 km", "Definição muscular", "Qualidade de vida", "Reabilitação de joelho"];

const EQUIPE = [
  { chave: "gestor", nome: "Renata Albuquerque", papel: "gestor", login: true },
  { chave: "recepcao", nome: "Paulo Henrique Dias", papel: "recepcao", login: true },
  { chave: "recepcao2", nome: "Larissa Moura", papel: "recepcao" },
  { chave: "professor", nome: "Diego Fontes", papel: "professor", login: true },
  { chave: "professor2", nome: "Camila Tavares", papel: "professor" },
  { chave: "professor3", nome: "Rodrigo Saldanha", papel: "professor" },
  { chave: "professor4", nome: "Bianca Freitas", papel: "professor" },
  { chave: "nutricionista", nome: "Helena Prado", papel: "nutricionista", login: true },
];
// Dois alunos com login, para mostrar o app: a aluna em dia que treina bem e
// o aluno com treino da semana pela metade.
const PERSONAS = [
  { chave: "aluna", nome: "Marina Costa Ribeiro", objetivo: "Emagrecimento", meta: 3, perfil: "assidua" },
  { chave: "aluno", nome: "Pedro Henrique Almeida", objetivo: "Hipertrofia", meta: 4, perfil: "irregular" },
];

function senhaDaApresentacao() {
  if (existsSync(ARQUIVO_ACESSOS)) {
    const linha = readFileSync(ARQUIVO_ACESSOS, "utf8").split(/\r?\n/).find((l) => l.startsWith("Senha:"));
    if (linha) return linha.slice("Senha:".length).trim();
  }
  return `Demo-${randomBytes(6).toString("base64url")}-${entre(10, 99)}`;
}

function gravarAcessos(senha) {
  const logins = [...EQUIPE.filter((p) => p.login), ...PERSONAS].map((p) => `  ${p.nome.padEnd(26)} ${p.chave}@${DOMINIO}`);
  writeFileSync(
    ARQUIVO_ACESSOS,
    [
      "ArkeFit: academia de demonstração (Ponto Alto Academia)",
      "",
      "Entrar em https://app.arkefit.com.br com um dos e-mails abaixo e a senha.",
      "É uma academia fictícia: nada aqui é de ninguém, e ela fica fora dos números da plataforma.",
      "Antes de uma apresentação, rode `node scripts/demonstracao/academia.mjs recriar` para as datas ficarem com a cara de hoje.",
      "",
      `Senha: ${senha}`,
      "",
      "Logins:",
      ...logins,
      "",
    ].join("\n"),
  );
}

async function orgDemo() {
  return (await sql(`select id from public.organizations where slug = ${q(SLUG)}`))[0]?.id ?? null;
}

async function criarConta(nome, email, senha) {
  const r = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: senha ?? `Aluno.${randomBytes(9).toString("base64url")}#1`, email_confirm: true, user_metadata: { full_name: nome } }),
  });
  const u = await r.json();
  if (!u.id) throw new Error(`conta ${email}: ${JSON.stringify(u).slice(0, 200)}`);
  return u.id;
}

async function emLotes(itens, tamanho, fazer) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fazer))));
  return saida;
}

async function inserirEmLotes(cabecalho, linhas, tamanho = 400) {
  for (let i = 0; i < linhas.length; i += tamanho) await sql(`${cabecalho} values ${linhas.slice(i, i + tamanho).join(",\n")}`);
}

async function semear() {
  if (await orgDemo()) {
    console.log("A academia de demonstração já existe. Use `recriar` para apagar e semear de novo.");
    return;
  }
  const senha = senhaDaApresentacao();

  // ── A academia ───────────────────────────────────────────────────────────
  const [org] = await sql(`insert into public.organizations (nome, slug, status, ficticia, tipo, plano_b2b, onboarding_completed,
      cnpj_cpf, tipo_empresa, razao_social, cep, logradouro, numero, bairro, cidade, uf, telefone, email_contato, trial_vencimento)
    values (${q(NOME)}, ${q(SLUG)}, 'trial', true, 'academia', 'growth', true,
      ${q(cnpj(31))}, 'LIMITED', 'Ponto Alto Academia (demonstração ArkeFit)', '04538-133', 'Avenida Brigadeiro Faria Lima', '3900', 'Itaim Bibi',
      'São Paulo', 'SP', '(11) 3030-4000', 'contato@${DOMINIO}', '2030-12-31')
    returning id`);
  const ORG = org.id;
  console.log("academia", ORG);

  // ── Contas ───────────────────────────────────────────────────────────────
  const ids = {};
  for (const p of [...EQUIPE, ...PERSONAS]) ids[p.chave] = await criarConta(p.nome, `${p.chave}@${DOMINIO}`, p.login || PERSONAS.includes(p) ? senha : null);

  const alunos = [];
  for (let i = 0; i < TOTAL_ALUNOS; i++) {
    const feminino = chance(0.55);
    const nome = `${um(feminino ? NOMES_F : NOMES_M)} ${um(SOBRENOMES)}${chance(0.45) ? ` ${um(SOBRENOMES)}` : ""}`;
    alunos.push({ chave: `aluno${String(i + 1).padStart(3, "0")}`, nome, indice: i });
  }
  const contas = await emLotes(alunos, 8, (a) => criarConta(a.nome, `${a.chave}@${DOMINIO}`, null));
  alunos.forEach((a, i) => (ids[a.chave] = contas[i]));
  console.log(`${Object.keys(ids).length} contas`);

  // O perfil nasce com a conta (gatilho do Auth): aqui só ganha nome,
  // telefone e CPF. O CPF vem antes da matrícula, que o exige.
  const pessoas = [...EQUIPE, ...PERSONAS, ...alunos];
  for (let i = 0; i < pessoas.length; i += 200) {
    const lote = pessoas.slice(i, i + 200);
    await sql(`update public.profiles p set full_name = v.n, phone = v.t, cpf = v.c
      from (values ${lote.map((x, j) => `(${q(ids[x.chave])}::uuid, ${q(x.nome)}, ${q(telefone(i + j + 3))}, ${q(cpf(i + j + 101))})`).join(",")}) as v(u, n, t, c)
      where p.user_id = v.u`);
  }
  await inserirEmLotes(
    "insert into public.organization_members (organization_id, user_id, role, status)",
    pessoas.map((x) => `(${q(ORG)}, ${q(ids[x.chave])}, ${q(x.papel ?? "aluno")}, 'active')`),
  );

  // ── Alunos ───────────────────────────────────────────────────────────────
  // Situação: a maior parte em dia; alguns inadimplentes e pausados. Perfil
  // de frequência: assíduo, irregular ou sumido (para a retenção mostrar quem
  // está em risco).
  const todosAlunos = [...PERSONAS.map((p, i) => ({ ...p, indice: -1 - i })), ...alunos];
  for (const a of todosAlunos) {
    a.diasDeCasa = a.perfil ? (a.chave === "aluna" ? 240 : 120) : entre(5, 540);
    a.meta = a.meta ?? um([2, 3, 3, 3, 4, 4, 5]);
    a.objetivo = a.objetivo ?? um(OBJETIVOS);
    a.situacao = a.perfil ? "em_dia" : chance(0.08) ? "inadimplente" : chance(0.065) ? "pausado" : "em_dia";
    a.perfil = a.perfil ?? (a.situacao === "pausado" ? "sumido" : chance(0.6) ? "assidua" : chance(0.6) ? "irregular" : "sumido");
    a.semAcesso = !PERSONAS.includes(a) && a.diasDeCasa < 10 && chance(0.5);
    const plano = um(["mensal", "mensal", "mensal", "mensal", "mensal", "trimestral", "trimestral", "anual"]);
    // O inadimplente fica no mensal: é a mensalidade do mês em atraso que
    // explica a situação dele na ficha.
    a.plano = a.situacao === "inadimplente" ? "mensal" : plano;
  }
  await inserirEmLotes(
    `insert into public.alunos (organization_id, user_id, objetivo, meta_semanal_dias, data_inicio, primeiro_acesso_em, ultima_atividade_em,
       situacao_academia, situacao_academia_motivo, situacao_academia_retorno, situacao_academia_em, meta_agua_ml, provedor_nutricao)`,
    todosAlunos.map((a) => {
      const ultima = a.semAcesso ? "null" : a.perfil === "sumido" ? `now() - interval '${entre(9, 30)} days'` : `now() - interval '${entre(1, 60)} hours'`;
      const motivo = a.situacao === "pausado" ? um(["Viagem", "Saúde", "Rotina de trabalho"]) : a.situacao === "inadimplente" ? "Mensalidade em atraso" : null;
      const retorno = a.situacao === "pausado" ? `current_date + ${entre(5, 40)}` : "null";
      return `(${q(ORG)}, ${q(ids[a.chave])}, ${q(a.objetivo)}, ${a.meta}, current_date - ${a.diasDeCasa},
        ${a.semAcesso ? "null" : `now() - interval '${Math.max(1, a.diasDeCasa - 1)} days'`}, ${ultima},
        ${q(a.situacao)}, ${q(motivo)}, ${retorno}, ${a.situacao === "em_dia" ? "null" : `now() - interval '${entre(2, 20)} days'`}, ${um([2000, 2500, 3000])}, 'nutricionista_academia')`;
    }),
  );
  // O cadastro nasce com a data de entrada do aluno, e não com a de hoje: sem
  // isso o resumo da semana contava os 182 como novos.
  await sql(`update public.alunos set created_at = data_inicio + time '09:00' where organization_id = ${q(ORG)}`);
  const mapa = await sql(`select id, user_id from public.alunos where organization_id = ${q(ORG)}`);
  const alunoPorUser = new Map(mapa.map((m) => [m.user_id, m.id]));
  for (const a of todosAlunos) a.id = alunoPorUser.get(ids[a.chave]);
  console.log(`${todosAlunos.length} alunos`);

  // ── Planos, matrículas e mensalidades ───────────────────────────────────
  await sql(`update public.planos_academia set ativo = true,
      valor = case periodicidade when 'mensal' then 149.90 when 'trimestral' then 419.70 when 'semestral' then 779.40 when 'anual' then 1438.80 else valor end
    where organization_id = ${q(ORG)}`);
  const planos = await sql(`select id, periodicidade, valor from public.planos_academia where organization_id = ${q(ORG)}`);
  const planoPor = Object.fromEntries(planos.map((p) => [p.periodicidade, p]));
  const taxa = (v) => Math.max(1.99, Math.round((v * 0.0299 + 0.49) * 100) / 100);
  const matriculaveis = todosAlunos.filter((a) => !a.semAcesso);
  await inserirEmLotes(
    `insert into public.aluno_matriculas_academia (organization_id, aluno_id, plano_id, valor_cobrado, dia_vencimento, data_inicio,
       valor_repasse_arke, valor_liquido_academia, registrado_por, status)`,
    matriculaveis.map((a) => {
      const p = planoPor[a.plano] ?? planoPor.mensal;
      const v = Number(p.valor);
      return `(${q(ORG)}, ${q(a.id)}, ${q(p.id)}, ${v}, ${entre(1, 28)}, current_date - ${a.diasDeCasa}, ${taxa(v)}, ${(v - taxa(v)).toFixed(2)},
        ${q(ids[um(["recepcao", "recepcao2"])])}, ${a.situacao === "pausado" ? "'pausada'" : "'ativa'"})`;
    }),
  );
  const matriculas = await sql(`select m.id, m.aluno_id, m.valor_cobrado, m.dia_vencimento, p.periodicidade
    from public.aluno_matriculas_academia m join public.planos_academia p on p.id = m.plano_id where m.organization_id = ${q(ORG)}`);
  const alunoPorId = new Map(todosAlunos.map((a) => [a.id, a]));
  // Mensalidades: até quatro competências por matrícula (a do mês e as três
  // anteriores), respeitando a data de entrada do aluno. Plano trimestral e
  // anual cobram de uma vez, no mês em que o período renova: cada aluno
  // entrou num mês, então as renovações se espalham pela janela. Cobrar todos
  // no mesmo mês punha meio ano de receita num mês só.
  const PERIODO_MESES = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
  const mensalidades = [];
  for (const m of matriculas) {
    const a = alunoPorId.get(m.aluno_id);
    const v = Number(m.valor_cobrado);
    const periodo = PERIODO_MESES[m.periodicidade] ?? 1;
    const mesesDeCasa = Math.floor(a.diasDeCasa / 30);
    for (const atras of [3, 2, 1, 0]) {
      if (atras * 30 > a.diasDeCasa) continue;
      if ((mesesDeCasa - atras) % periodo !== 0) continue;
      const venc = `(date_trunc('month', current_date) - interval '${atras} months' + interval '${Math.min(m.dia_vencimento, 28) - 1} days')::date`;
      let status = "confirmado";
      if (atras === 0) status = a.situacao === "inadimplente" ? "atrasado" : chance(0.35) ? "pendente" : "confirmado";
      if (a.situacao === "inadimplente" && atras === 1 && chance(0.4)) status = "atrasado";
      if (a.situacao === "pausado" && atras === 0) continue;
      mensalidades.push({ m, venc, status, v, atras, forma: um(["cartao", "cartao", "pix", "pix", "boleto"]) });
    }
  }
  await inserirEmLotes(
    `insert into public.mensalidades (organization_id, matricula_id, aluno_id, competencia, valor, vencimento, status, valor_repasse_arke, valor_liquido_academia)`,
    mensalidades.map((x) => `(${q(ORG)}, ${q(x.m.id)}, ${q(x.m.aluno_id)}, date_trunc('month', current_date - interval '${x.atras} months')::date, ${x.v}, ${x.venc},
      ${x.status === "atrasado" ? "'atrasado'" : "'pendente'"}, ${taxa(x.v)}, ${(x.v - taxa(x.v)).toFixed(2)})`),
  );
  // Confirmar depois de inserir: é na troca para confirmado que o lançamento
  // de receita nasce, como numa cobrança de verdade.
  await sql(`update public.mensalidades m set status = 'confirmado', data_pagamento = least(m.vencimento + (abs(hashtext(m.id::text)) % 3), current_date),
      forma_pagamento = (array['cartao','cartao','pix','pix','boleto'])[1 + abs(hashtext(m.id::text || 'f')) % 5]::public.forma_pagamento_mensalidade,
      taxa_gateway = case when abs(hashtext(m.id::text || 'f')) % 5 < 2 then round(m.valor * 0.0299 + 0.49, 2) else 1.99 end
    where m.organization_id = ${q(ORG)} and m.status = 'pendente'
      and (m.vencimento < current_date - 1 or abs(hashtext(m.id::text)) % 100 < 65)`);
  console.log(`${mensalidades.length} mensalidades`);

  // ── Treinos e dietas ─────────────────────────────────────────────────────
  // Treino publicado a partir dos modelos que toda academia nova recebe, pelo
  // professor de cada aluno.
  const professores = ["professor", "professor2", "professor3", "professor4"];
  const comTreino = todosAlunos.filter((a) => !a.semAcesso && a.situacao !== "pausado");
  const modelos = await sql(`select id, titulo from public.modelos_treino where organization_id = ${q(ORG)} order by titulo`);
  const publicar = comTreino.map((a, i) => {
    const m = modelos[i % modelos.length];
    a.professor = professores[i % professores.length];
    return `perform public.publicar_treino(${q(a.id)}, ${q(m.id)}, ${q(`${m.titulo} — ${a.nome.split(" ")[0]}`)}, current_date - ${entre(5, 50)}, current_date + ${entre(20, 60)});`;
  });
  for (let i = 0; i < publicar.length; i += 40) await sql(`do $$ begin ${publicar.slice(i, i + 40).join("\n")} end $$`);
  await sql(`update public.treinos t set publicado_por = v.p from (values ${comTreino.map((a) => `(${q(a.id)}::uuid, ${q(ids[a.professor])}::uuid)`).join(",")}) as v(a, p) where t.aluno_id = v.a`);
  console.log(`${comTreino.length} treinos`);

  const refeicoes = [
    { ordem: 1, nome_refeicao: "Café da manhã", horario_sugerido: "07:00", itens: "2 ovos mexidos\n1 fatia de pão integral\n1 fruta", calorias_kcal: 380, proteinas_g: 22, carboidratos_g: 38, gorduras_g: 14 },
    { ordem: 2, nome_refeicao: "Lanche da manhã", horario_sugerido: "10:00", itens: "Iogurte natural\n1 colher de sopa de aveia", calorias_kcal: 190, proteinas_g: 11, carboidratos_g: 24, gorduras_g: 5 },
    { ordem: 3, nome_refeicao: "Almoço", horario_sugerido: "12:30", itens: "Arroz (4 colheres)\nFeijão (1 concha)\nFrango grelhado (120 g)\nSalada à vontade", calorias_kcal: 620, proteinas_g: 42, carboidratos_g: 70, gorduras_g: 16 },
    { ordem: 4, nome_refeicao: "Lanche da tarde", horario_sugerido: "16:00", itens: "1 banana\n2 castanhas-do-pará", calorias_kcal: 160, proteinas_g: 3, carboidratos_g: 27, gorduras_g: 6 },
    { ordem: 5, nome_refeicao: "Jantar", horario_sugerido: "20:00", itens: "Omelete de 2 ovos com legumes\nSalada verde", calorias_kcal: 350, proteinas_g: 24, carboidratos_g: 12, gorduras_g: 20 },
  ];
  const comDieta = comTreino.filter((a, i) => a.chave === "aluna" || i % 4 === 0);
  await inserirEmLotes(
    "insert into public.dietas (organization_id, aluno_id, titulo, snapshot_conteudo, publicado_por, status)",
    comDieta.map((a) => `(${q(ORG)}, ${q(a.id)}, ${q(a.objetivo === "Hipertrofia" ? "Plano alimentar — ganho de massa" : "Plano alimentar — reeducação")}, ${q(JSON.stringify(refeicoes))}::jsonb, ${q(ids.nutricionista)}, 'ativo')`),
  );
  console.log(`${comDieta.length} dietas`);

  // ── Frequência das últimas oito semanas ─────────────────────────────────
  const treinoDoAluno = new Map((await sql(`select aluno_id, id from public.treinos where organization_id = ${q(ORG)} and status = 'ativo'`)).map((t) => [t.aluno_id, t.id]));
  const registros = [];
  const presencas = [];
  for (const a of comTreino) {
    const adesao = a.perfil === "assidua" ? 0.95 : a.perfil === "irregular" ? 0.55 : 0.2;
    const ultimoDia = a.perfil === "sumido" ? entre(9, 25) : a.chave === "aluna" ? 0 : entre(0, 3);
    const inicio = Math.min(56, a.diasDeCasa);
    const usados = new Set();
    for (let semana = 0; semana * 7 < inicio; semana++) {
      const vezes = Math.round(a.meta * adesao + (sorteio() - 0.5));
      for (let k = 0; k < vezes; k++) {
        const dia = semana * 7 + entre(0, 6);
        if (dia < ultimoDia || dia > inicio || usados.has(dia)) continue;
        usados.add(dia);
      }
    }
    if (a.chave === "aluna") [0, 2, 4].forEach((d) => usados.add(d));
    for (const dia of usados) {
      const divisao = um(["A", "B", "C"]);
      // Sem "dor" no sorteio: cada relato de dor abre um caso crítico na fila,
      // e os da demonstração são os escritos à mão, mais abaixo.
      const sensacao = um(["otimo", "otimo", "bom", "bom", "regular", "dificil"]);
      registros.push(`(${q(ORG)}, ${q(a.id)}, ${q(treinoDoAluno.get(a.id) ?? null)}, current_date - ${dia}, true, ${q(divisao)}, ${entre(5, 9)}, ${q(sensacao)}, ${entre(40, 75)})`);
      presencas.push(`(${q(ORG)}, ${q(a.id)}, current_date - ${dia}, 'qr', (current_date - ${dia}) + time '06:00' + make_interval(mins => ${entre(0, 900)}))`);
    }
  }
  await inserirEmLotes("insert into public.registro_treino (organization_id, aluno_id, treino_id, data, concluido, divisao, esforco_percebido, sensacao, duracao_min)", registros);
  await inserirEmLotes("insert into public.presencas (organization_id, aluno_id, dia, origem, registrada_em)", presencas.map((p) => p));
  // Cada treino registrado fica numa divisão que existe na ficha do aluno, com
  // todos os exercícios dela feitos e uma carga: é o que o app grava quando o
  // aluno conclui. Sem isso a tela dizia "treino de hoje concluído" ao lado
  // de "0/6 exercícios".
  await sql(`update public.registro_treino r set divisao = x.divs[1 + abs(hashtext(r.id::text)) % array_length(x.divs, 1)]
    from (select t.id, array_agg(distinct coalesce(e->>'divisao', 'A') order by coalesce(e->>'divisao', 'A')) as divs
            from public.treinos t, jsonb_array_elements(t.snapshot_conteudo) e where t.organization_id = ${q(ORG)} group by t.id) x
    where r.treino_id = x.id and r.organization_id = ${q(ORG)}`);
  await sql(`update public.registro_treino r set detalhes_execucao = coalesce((
      select jsonb_agg(jsonb_build_object('ordem', (e->>'ordem')::int, 'concluido', true, 'carga_kg', (8 + abs(hashtext(r.id::text || (e->>'ordem'))) % 40)::text))
        from public.treinos t, jsonb_array_elements(t.snapshot_conteudo) e
       where t.id = r.treino_id and coalesce(e->>'divisao', 'A') = r.divisao), '[]'::jsonb)
    where r.organization_id = ${q(ORG)} and r.concluido`);
  console.log(`${registros.length} treinos registrados, ${presencas.length} presenças`);

  // Adesão à dieta nas duas últimas semanas, refeição por refeição, como o
  // aluno marca no app; quem sumiu não marca.
  const dietaDoAluno = new Map((await sql(`select aluno_id, id from public.dietas where organization_id = ${q(ORG)} and status = 'ativo'`)).map((d) => [d.aluno_id, d.id]));
  const adesoes = [];
  for (const a of comDieta) {
    if (a.perfil === "sumido" || !dietaDoAluno.has(a.id)) continue;
    const segue = a.chave === "aluna" ? 0.85 : a.perfil === "assidua" ? 0.8 : 0.55;
    for (let dia = 0; dia < 14; dia++) {
      if (!chance(a.chave === "aluna" ? 0.9 : 0.7)) continue;
      const marcadas = Object.fromEntries(refeicoes.map((r) => [String(r.ordem), chance(segue)]));
      const pct = Math.round((Object.values(marcadas).filter(Boolean).length / refeicoes.length) * 100);
      adesoes.push(`(${q(ORG)}, ${q(a.id)}, ${q(dietaDoAluno.get(a.id))}, current_date - ${dia}, ${pct}, ${q(JSON.stringify(marcadas))}::jsonb,
        ${entre(4, 11) * 250}, ${chance(0.2)}, ${chance(0.1)}, ${q(um(["sem_fome", "sem_fome", "fome_leve", "fome_moderada"]))})`);
    }
  }
  await inserirEmLotes("insert into public.dieta_adesao (organization_id, aluno_id, dieta_id, data, adesao_percentual, refeicoes_marcadas, agua_ml, consumiu_doce, consumiu_alcool, nivel_saciedade)", adesoes);
  console.log(`${adesoes.length} dias de adesão à dieta`);

  // ── Check-ins da semana ──────────────────────────────────────────────────
  const checkins = [];
  for (const a of comTreino.filter((x) => x.perfil !== "sumido")) {
    if (!chance(0.5)) continue;
    // "Preciso de ajuste" abre um caso na fila pelo gatilho de verdade: poucos,
    // para a fila da demonstração ficar com casos variados.
    const status = chance(0.06) ? "preciso_ajuste" : chance(0.08) ? "com_dificuldade" : "funcionando_bem";
    const motivo = status === "com_dificuldade" ? um(["tempo", "motivacao", "alimentacao"]) : null;
    const dia = entre(0, 6);
    checkins.push(`(${q(ORG)}, ${q(a.id)}, ${q(status)}, ${q(motivo)}, null, current_date - ${dia}, now() - interval '${dia} days')`);
  }
  await inserirEmLotes("insert into public.checkins (organization_id, aluno_id, status, motivo_dificuldade, comentario, data, created_at)", checkins);

  // ── Fila de atendimento: casos abertos e resolvidos ─────────────────────
  const fila = [];
  const sorteados = [...comTreino].sort(() => sorteio() - 0.5);
  const abertas = [
    ["dor", "critica", "Relatou dor no joelho no treino de pernas", 6],
    ["dor", "alta", "Sentiu a lombar no levantamento terra", 20],
    ["barreira", "media", "Tinha 3 treinos previstos na semana e não registrou nenhum", 30],
    ["barreira", "media", "Dois treinos previstos sem registro", -5],
    ["ajuste", "media", "Pediu ajuste: o treino está longo para o horário do almoço", 40],
    ["ajuste", "baixa", "Quer incluir corrida na esteira no fim do treino", 60],
    ["ativacao", "media", "Matriculado há 3 dias e ainda não entrou no app", -10],
    ["ativacao", "media", "Matriculado há 2 dias e ainda não entrou no app", 14],
    ["cobranca", "alta", "Mensalidade vencida há 6 dias", 8],
    ["cobranca", "alta", "Mensalidade vencida há 3 dias", 24],
    ["anamnese", "alta", "Concluiu a anamnese: avaliar antes do primeiro treino", 18],
    ["outro", "media", "Pediu para trocar o horário com o professor", 50],
    ["atestado", "media", "PAR-Q com resposta positiva e atestado ainda não enviado", 70],
  ];
  abertas.forEach(([tipo, prioridade, motivo, horas], i) => {
    const a = sorteados[i];
    fila.push(`(${q(ORG)}, ${q(a.id)}, ${q(tipo)}, ${q(prioridade)}, ${q(motivo)}, 'aberta', now() + interval '${horas} hours', ${q(`demo:aberta:${i}`)}, 'academia',
      ${i % 3 === 0 ? q(ids[a.professor ?? "professor"]) : "null"}, null, null, now() - interval '${entre(2, 40)} hours', null)`);
  });
  const resolvidas = [
    ["dor", "Dor no ombro no supino", "Ajustada a pegada e reduzida a carga por duas semanas; aluno sem dor no treino seguinte."],
    ["barreira", "Três treinos sem registro", "Conversa na recepção: mudou de turno no trabalho. Treino reorganizado para a noite."],
    ["ajuste", "Pediu treino mais curto", "Treino reorganizado em 45 minutos, em divisão A/B."],
    ["ativacao", "Não tinha entrado no app", "Recepção mostrou o QR Code do primeiro acesso; aluno entrou na hora."],
    ["cobranca", "Mensalidade em atraso", "Aluno cadastrou o cartão para a cobrança automática; mensalidade paga."],
    ["anamnese", "Anamnese concluída", "Avaliação feita, treino de adaptação publicado."],
  ];
  for (let i = 0; i < 36; i++) {
    const [tipo, motivo, desfecho] = resolvidas[i % resolvidas.length];
    const a = sorteados[20 + i];
    const dias = entre(1, 45);
    fila.push(`(${q(ORG)}, ${q(a.id)}, ${q(tipo)}, ${q(um(["media", "alta", "media"]))}, ${q(motivo)}, 'concluida', now() - interval '${dias} days' + interval '8 hours',
      ${q(`demo:resolvida:${i}`)}, 'academia', ${q(ids[a.professor ?? "professor"])}, ${q(desfecho)}, ${q(desfecho)}, now() - interval '${dias} days', now() - interval '${dias} days' + interval '${entre(1, 7)} hours')`);
  }
  await inserirEmLotes(
    "insert into public.tarefas (organization_id, aluno_id, tipo, prioridade, motivo, status, sla_prazo, origem_evento, dono, responsavel_id, acao, desfecho_acao, created_at, concluida_em)",
    fila,
  );
  console.log(`${fila.length} casos na fila`);

  // ── Mensagens com os professores ────────────────────────────────────────
  const conversas = [
    ["Professor, posso trocar o treino de quinta para sexta essa semana?", "Pode sim! Só não emende dois de pernas seguidos."],
    ["Consegui subir a carga do agachamento!", "Muito bom! Semana que vem a gente revisa a técnica com o peso novo."],
    ["Senti um incômodo no ombro no desenvolvimento.", "Obrigado por avisar. Na próxima troque pelo elevação lateral e me procure no salão."],
    ["Quantas séries faço no abdômen?", "Três séries de 15. Está na ficha, na divisão C."],
    ["Vou viajar sexta, faço o treino de sexta na quinta?", "Faz sim. Boa viagem!"],
  ];
  const mensagens = [];
  sorteados.slice(60, 85).forEach((a, i) => {
    const [pergunta, resposta] = conversas[i % conversas.length];
    const horas = entre(1, 72);
    mensagens.push(`(${q(ORG)}, ${q(a.id)}, ${q(ids[a.chave])}, 'aluno', ${q(pergunta)}, ${i % 3 === 0 ? "false" : "true"}, now() - interval '${horas + 2} hours')`);
    if (i % 3 !== 0) mensagens.push(`(${q(ORG)}, ${q(a.id)}, ${q(ids[a.professor ?? "professor"])}, 'treinador', ${q(resposta)}, ${i % 2 === 0 ? "true" : "false"}, now() - interval '${horas} hours')`);
  });
  await inserirEmLotes("insert into public.mensagens_treino (organization_id, aluno_id, remetente_id, remetente_tipo, mensagem, lida, created_at)", mensagens);

  // ── Avaliações físicas: duas por aluno, para mostrar evolução ───────────
  const avaliacoes = [];
  for (const a of comTreino.filter((x, i) => x.chave === "aluna" || i % 3 === 0)) {
    const peso = entre(58, 98) + sorteio();
    const altura = entre(155, 188);
    const gordura = entre(18, 34);
    const desce = a.objetivo === "Hipertrofia" ? -1 : 1;
    avaliacoes.push(`(${q(ORG)}, ${q(a.id)}, ${q(ids[a.professor ?? "professor"])}, current_date - 90, ${peso.toFixed(1)}, ${altura}, ${gordura}, current_date - 30, ${(peso - desce * 4).toFixed(1)}, ${q(desce > 0 ? "diminuir" : "aumentar")}, ${gordura - 4}, 'diminuir')`);
    avaliacoes.push(`(${q(ORG)}, ${q(a.id)}, ${q(ids[a.professor ?? "professor"])}, current_date - 30, ${(peso - desce * 2.1).toFixed(1)}, ${altura}, ${gordura - 2}, current_date + 60, ${(peso - desce * 4).toFixed(1)}, ${q(desce > 0 ? "diminuir" : "aumentar")}, ${gordura - 4}, 'diminuir')`);
  }
  await inserirEmLotes(
    "insert into public.avaliacoes_fisicas (organization_id, aluno_id, avaliado_por, data_avaliacao, peso_kg, altura_cm, percentual_gordura, data_proxima_avaliacao, meta_peso_kg, meta_peso_direcao, meta_gordura_valor, meta_gordura_direcao)",
    avaliacoes,
  );
  console.log(`${avaliacoes.length} avaliações físicas`);

  // ── Funil, comunicados, despesas e um desafio ───────────────────────────
  const leads = [
    ["Renata Oliveira", "Instagram", "novo", "Perguntou sobre o horário da manhã", null, 1],
    ["Diego Martins", "Indicação", "contato", "Amigo de um aluno da musculação", null, 2],
    ["Patrícia Gomes", "Passou na frente", "experimental", "Aula experimental quinta às 19h", null, 3],
    ["Vinícius Araújo", "Google", "negociacao", "Quer o plano trimestral", null, 5],
    ["Beatriz Santos", "Instagram", "matriculado", null, null, 8],
    ["Rodrigo Pires", "Indicação", "perdido", null, "Horário não encaixa", 12],
    ["Juliana Teixeira", "Google", "novo", "Quer saber de avaliação física", null, 0],
    ["Marcos Vinícius Lima", "Instagram", "contato", "Treina em casa, quer acompanhamento", null, 4],
    ["Aline Barros", "Indicação", "experimental", "Aula experimental sábado de manhã", null, 2],
    ["Felipe Andrade", "Passou na frente", "negociacao", "Quer pagar no cartão em 3 vezes", null, 6],
    ["Carla Nogueira", "Instagram", "matriculado", null, null, 15],
    ["Thiago Rezende", "Google", "perdido", null, "Achou o preço alto", 20],
  ];
  await inserirEmLotes(
    "insert into public.leads (organization_id, nome, telefone, origem, etapa, observacao, motivo_perda, criado_por, created_at)",
    leads.map(([nome, origem, etapa, obs, perda, dias], i) => `(${q(ORG)}, ${q(nome)}, ${q(telefone(900 + i))}, ${q(origem)}, ${q(etapa)}, ${q(obs)}, ${q(perda)}, ${q(ids.recepcao)}, now() - interval '${dias} days')`),
  );
  await sql(`insert into public.comunicados (organization_id, titulo, mensagem, publico, criado_por, expira_em, criado_em) values
    (${q(ORG)}, 'Horário do feriado', 'No feriado a academia abre das 8h às 14h. Bons treinos!', 'todos', ${q(ids.gestor)}, current_date + 15, now() - interval '2 days'),
    (${q(ORG)}, 'Aulas de mobilidade', 'Toda terça e quinta às 19h, com a professora Camila. Vagas na recepção.', 'alunos', ${q(ids.gestor)}, current_date + 30, now() - interval '5 days'),
    (${q(ORG)}, 'Reunião de equipe', 'Sexta às 14h, para alinhar a escala do mês.', 'equipe', ${q(ids.gestor)}, current_date + 4, now() - interval '1 day')`);
  // Despesas fixas de cada mês da janela, no dia em que vencem: o que já
  // venceu está pago, o que vence depois de hoje fica a pagar. A manutenção
  // aparece só em alguns meses, como na vida real.
  await sql(`insert into public.lancamentos_financeiros (organization_id, tipo, categoria, descricao, valor, data, vencimento, data_pagamento, status, registrado_por)
    select ${q(ORG)}, 'despesa', l.c, l.d, l.v, dia, dia, case when dia <= current_date then dia end,
           case when dia <= current_date then 'pago' else 'pendente' end::public.lancamento_status, ${q(ids.gestor)}
      from generate_series(0, 3) as atras,
           (values ('Aluguel', 'Aluguel do salão', 7800::numeric, 10, -1), ('Energia', 'Conta de luz', 2350::numeric, 15, -1),
                   ('Água', 'Conta de água', 480::numeric, 15, -1), ('Internet', 'Link de internet', 289::numeric, 10, -1),
                   ('Limpeza', 'Material de limpeza', 420::numeric, 20, -1), ('Marketing', 'Anúncios no Instagram', 1200::numeric, 5, -1),
                   ('Manutenção', 'Revisão das esteiras', 980::numeric, 22, 2), ('Manutenção', 'Troca de cabos e polias', 640::numeric, 18, 0))
             as l(c, d, v, dia_do_mes, so_atras),
           lateral (select (date_trunc('month', current_date) - make_interval(months => atras) + make_interval(days => l.dia_do_mes - 1))::date as dia) as quando
      where l.so_atras = -1 or l.so_atras = atras`);
  const [desafio] = await sql(`insert into public.desafios (organization_id, titulo, descricao, tipo, meta_valor, data_inicio, data_fim, pontos, criado_por, para_todos)
    values (${q(ORG)}, 'Outubro sem faltar', '12 treinos no mês: quem completar ganha uma camiseta da academia.', 'numero_treinos', 12,
      date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 50, ${q(ids.gestor)}, false) returning id`);
  await inserirEmLotes(
    "insert into public.desafio_participantes (organization_id, desafio_id, aluno_id)",
    comTreino.filter((a, i) => a.chave === "aluna" || i % 5 === 0).map((a) => `(${q(ORG)}, ${q(desafio.id)}, ${q(a.id)})`),
  );

  // ── Resumo da semana ─────────────────────────────────────────────────────
  // A academia fictícia fica fora do envio semanal, que manda e-mail; o resumo
  // desta semana é gravado aqui, com os números da mesma função do envio.
  await sql(`insert into public.briefings_enviados (organization_id, semana, numeros, enviado_em)
    select ${q(ORG)}, date_trunc('week', current_date::timestamp)::date,
           jsonb_build_object('ativos', b.alunos_ativos, 'ativos_mes_passado', b.alunos_ativos_mes_passado, 'retencao_pct', b.retencao_pct,
             'variacao_pct', b.variacao_pct, 'novos', b.novos_na_semana, 'em_risco', b.em_risco, 'resgates', b.resgates_do_mentor,
             'presenciais', b.chamados_para_a_academia), now()
      from public.briefing_semanal_organizacao(${q(ORG)}) b`);

  // ── Aceite dos documentos, para os logins abrirem direto ────────────────
  const docs = await sql(`select distinct on (tipo) id, tipo from public.documentos_legais order by tipo, versao desc`);
  const aceites = [];
  for (const p of [...EQUIPE, ...PERSONAS]) {
    for (const d of docs) {
      if (d.tipo === "contrato_academia" && p.papel !== "gestor") continue;
      aceites.push(`(${q(d.id)}, ${q(ids[p.chave])}, ${d.tipo === "contrato_academia" ? q(ORG) : "null"}, 'academia de demonstração')`);
    }
  }
  await sql(`insert into public.aceites_documentos (documento_id, user_id, organization_id, user_agent) values ${aceites.join(",")}`);

  gravarAcessos(senha);
  console.log(`\npronto: ${EQUIPE.length} na equipe, ${todosAlunos.length} alunos. Logins e senha em ${ARQUIVO_ACESSOS}`);
}

async function limpar() {
  const ORG = await orgDemo();
  const contas = await sql(`select id from auth.users where email like ${q(`%@${DOMINIO}`)}`);
  if (ORG) {
    // Trial nunca foi ao Asaas: não há cobrança viva para a trava de exclusão barrar.
    await sql(`delete from public.organizations where id = ${q(ORG)}`);
    console.log("academia apagada");
  }
  await emLotes(contas, 8, (c) => admin(`/admin/users/${c.id}`, { method: "DELETE" }));
  console.log(`${contas.length} contas apagadas`);
  const orfaos = await sql(`select count(*)::int n from public.alunos a where not exists (select 1 from public.organizations o where o.id = a.organization_id)`);
  console.log(orfaos[0].n ? `ATENÇÃO: ${orfaos[0].n} aluno(s) órfão(s)` : "nenhum aluno órfão");
}

const comando = process.argv[2];
if (comando === "semear") await semear();
else if (comando === "limpar") await limpar();
else if (comando === "recriar") {
  await limpar();
  await semear();
} else console.log("uso: node scripts/demonstracao/academia.mjs semear|recriar|limpar");

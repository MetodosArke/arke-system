// Academia de demonstração para as imagens da Central de Ajuda.
//
//   ARKE_CHAVES=... node scripts/ajuda/demonstracao.mjs semear
//   ARKE_CHAVES=... node scripts/ajuda/demonstracao.mjs limpar
//
// Cria uma academia fictícia ("Academia Horizonte"), em **trial** — trial é
// homologação: não é cobrada, fala com o sandbox do Asaas e nunca é cliente —,
// com equipe, alunos, treinos, fila, mensagens, funil e pagamentos inventados,
// para as telas da ajuda mostrarem o produto em uso sem dado de ninguém.
// `limpar` apaga tudo: a organização (em cascata), as contas e a conferência
// de órfãos. As contas usam o domínio demo.arkefit.com.br, que não recebe
// e-mail, e nenhuma chamada daqui envia e-mail.
//
// As sessões das contas saem em `scripts/ajuda/.sessoes.json` (fora do git),
// para `capturar-telas.mjs` abrir as telas como cada papel.
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SESSOES = join(AQUI, ".sessoes.json");
const PROJETO = process.env.ARKE_DESTINO ?? "lzyxqjibkfblrrjboylp";
const URL = `https://${PROJETO}.supabase.co`;
const SLUG = "horizonte-demo";
const DOMINIO = "demo.arkefit.com.br";

function porPrefixo(prefixo) {
  const a = process.env.ARKE_CHAVES;
  if (!a) return null;
  return readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(prefixo)) ?? null;
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim() || porPrefixo("sbp_");
if (!TOKEN) throw new Error("Sem token de acesso (sbp_).");

const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 800));
  return t.trim() ? JSON.parse(t) : null;
};
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);

const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const SERVICE = chaves.find((k) => k.name === "service_role").api_key;
const ANON = chaves.find((k) => k.name === "anon").api_key;
const admin = (caminho, init = {}) =>
  fetch(`${URL}/auth/v1${caminho}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

// CPF válido pelo dígito verificador, gerado a partir de uma semente fixa:
// sintético, e o mesmo a cada execução.
function cpf(semente) {
  const n = String(100000000 + ((semente * 7919) % 899999999)).slice(0, 9).split("").map(Number);
  const dv = (base) => {
    const s = base.reduce((a, d, i) => a + d * (base.length + 1 - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join("");
}

const EQUIPE = [
  { chave: "gestor", nome: "Carla Mendes", papel: "gestor" },
  { chave: "recepcao", nome: "Bruno Lima", papel: "recepcao" },
  { chave: "professor", nome: "Rafael Souza", papel: "professor" },
  { chave: "nutricionista", nome: "Juliana Prado", papel: "nutricionista" },
];
const ALUNOS = [
  { chave: "marina", nome: "Marina Costa", objetivo: "Ganhar condicionamento e perder gordura", meta: 3, fase: "rota", metodo: "integrado" },
  { chave: "pedro", nome: "Pedro Almeida", objetivo: "Hipertrofia", meta: 4, fase: "base" },
  { chave: "ana", nome: "Ana Beatriz Rocha", objetivo: "Voltar a treinar depois da gestação", meta: 2, fase: "mapa", metodo: "elite" },
  { chave: "lucas", nome: "Lucas Ferreira", objetivo: "Correr 10 km", meta: 3, fase: "base" },
  { chave: "camila", nome: "Camila Duarte", objetivo: "Saúde e disposição", meta: 2, fase: "base", situacao: "pausado", motivo: "Viagem" },
  { chave: "thiago", nome: "Thiago Nunes", objetivo: "Hipertrofia", meta: 5, fase: "apex", situacao: "inadimplente" },
  { chave: "fernanda", nome: "Fernanda Lopes", objetivo: "Fortalecer a lombar", meta: 3, fase: "base" },
  { chave: "gustavo", nome: "Gustavo Reis", objetivo: "Emagrecimento", meta: 3, fase: "mapa", semAcesso: true },
];

async function orgDemo() {
  return (await sql(`select id from public.organizations where slug = ${q(SLUG)}`))[0]?.id ?? null;
}

async function criarConta(nome, email) {
  const r = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password: `Demo.${Math.random().toString(36).slice(2)}#9Aa`, email_confirm: true, user_metadata: { full_name: nome } }),
  });
  const u = await r.json();
  if (!u.id) throw new Error(`conta ${email}: ${JSON.stringify(u).slice(0, 200)}`);
  return u.id;
}

async function sessao(email) {
  const g = await (await admin("/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) })).json();
  const v = await (
    await fetch(`${URL}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", token_hash: g?.properties?.hashed_token ?? g?.hashed_token }),
    })
  ).json();
  if (!v.access_token) throw new Error(`sessão ${email}: ${JSON.stringify(v).slice(0, 200)}`);
  return v;
}

async function semear() {
  if (await orgDemo()) {
    console.log("A academia de demonstração já existe; rode `limpar` antes para recriar.");
    return;
  }
  const [org] = await sql(`insert into public.organizations (nome, slug, status, tipo, plano_b2b, onboarding_completed, onboarding_concluido_em,
      cidade, uf, telefone, email_contato, razao_social, trial_vencimento)
    values ('Academia Horizonte', ${q(SLUG)}, 'trial', 'academia', 'growth', true, now(),
      'São Paulo', 'SP', '(11) 3333-0000', 'contato@${DOMINIO}', 'Academia Horizonte (demonstração)', current_date + 30)
    returning id`);
  const ORG = org.id;
  console.log("organização", ORG);

  const ids = {};
  for (const p of EQUIPE) ids[p.chave] = await criarConta(p.nome, `${p.chave}@${DOMINIO}`);
  for (const a of ALUNOS) ids[a.chave] = await criarConta(a.nome, `${a.chave}@${DOMINIO}`);

  const pessoas = [...EQUIPE, ...ALUNOS];
  await sql(pessoas
    .map((p, i) => `insert into public.profiles (user_id, full_name, phone, cpf) values (${q(ids[p.chave])}, ${q(p.nome)}, ${q(`(11) 9${String(81000000 + i * 1373).slice(0, 8)}`)}, ${q(cpf(i + 11))})
      on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone, cpf = excluded.cpf;`)
    .join("\n"));
  await sql(pessoas
    .map((p) => `insert into public.organization_members (organization_id, user_id, role, status) values (${q(ORG)}, ${q(ids[p.chave])}, ${q(p.papel ?? "aluno")}, 'active');`)
    .join("\n"));

  const alunoId = {};
  for (const [i, a] of ALUNOS.entries()) {
    const [r] = await sql(`insert into public.alunos (organization_id, user_id, objetivo, meta_semanal_dias, fase_jornada, data_inicio, primeiro_acesso_em,
        ultima_atividade_em, nivel_atacado, metodo_arke_status, metodo_arke_ativado_em, meta_agua_ml, provedor_nutricao)
      values (${q(ORG)}, ${q(ids[a.chave])}, ${q(a.objetivo)}, ${a.meta}, ${q(a.fase)}, current_date - ${40 + i * 23},
        ${a.semAcesso ? "null" : "now() - interval '20 days'"}, ${a.semAcesso ? "null" : "now() - interval '3 hours'"},
        ${a.metodo ? q(a.metodo) : "null"}, ${a.metodo ? "'ativo'" : "'sem_adesao'"}, ${a.metodo ? "now() - interval '30 days'" : "null"}, 2500,
        'nutricionista_academia')
      returning id`);
    alunoId[a.chave] = r.id;
    if (a.situacao) {
      await sql(`update public.alunos set situacao_academia = ${q(a.situacao)}, situacao_academia_motivo = ${q(a.motivo ?? "Mensalidade de setembro em aberto")},
        situacao_academia_em = now() - interval '2 days' where id = ${q(r.id)}`);
    }
  }

  // Treino publicado a partir dos modelos que toda academia nova recebe.
  const modelos = await sql(`select id, titulo as nome from public.modelos_treino where organization_id = ${q(ORG)} order by titulo`);
  for (const [i, chave] of ["marina", "pedro", "lucas", "fernanda", "thiago", "ana"].entries()) {
    const m = modelos[i % modelos.length];
    await sql(`select public.publicar_treino(${q(alunoId[chave])}, ${q(m.id)}, ${q(`${m.nome} — ${ALUNOS.find((a) => a.chave === chave).nome.split(" ")[0]}`)}, current_date - 10, current_date + 50)`);
    await sql(`update public.treinos set publicado_por = ${q(ids.professor)} where aluno_id = ${q(alunoId[chave])}`);
  }

  // Dieta de duas alunas.
  const refeicoes = [
    { ordem: 1, nome_refeicao: "Café da manhã", horario_sugerido: "07:00", itens: "2 ovos mexidos\n1 fatia de pão integral\n1 fruta", calorias_kcal: 380, proteinas_g: 22, carboidratos_g: 38, gorduras_g: 14 },
    { ordem: 2, nome_refeicao: "Almoço", horario_sugerido: "12:30", itens: "Arroz (4 colheres)\nFeijão (1 concha)\nFrango grelhado (120 g)\nSalada à vontade", calorias_kcal: 620, proteinas_g: 42, carboidratos_g: 70, gorduras_g: 16 },
    { ordem: 3, nome_refeicao: "Lanche", horario_sugerido: "16:00", itens: "Iogurte natural\n1 colher de aveia", calorias_kcal: 210, proteinas_g: 12, carboidratos_g: 26, gorduras_g: 6 },
    { ordem: 4, nome_refeicao: "Jantar", horario_sugerido: "20:00", itens: "Omelete de 2 ovos com legumes\nSalada verde", calorias_kcal: 350, proteinas_g: 24, carboidratos_g: 12, gorduras_g: 20 },
  ];
  for (const chave of ["marina", "ana", "pedro"]) {
    await sql(`insert into public.dietas (organization_id, aluno_id, titulo, snapshot_conteudo, publicado_por, status)
      values (${q(ORG)}, ${q(alunoId[chave])}, 'Plano alimentar — reeducação', ${q(JSON.stringify(refeicoes))}::jsonb, ${q(ids.nutricionista)}, 'ativo')`);
  }

  // Treinos registrados e presenças da semana, para calendário e progresso.
  const treinoDe = async (chave) => (await sql(`select id from public.treinos where aluno_id = ${q(alunoId[chave])} limit 1`))[0]?.id;
  for (const [chave, dias] of [["marina", [1, 3, 6, 8, 10]], ["pedro", [1, 2, 4, 5]], ["lucas", [2, 6]], ["fernanda", [1, 4]]]) {
    const t = await treinoDe(chave);
    for (const d of dias) {
      await sql(`insert into public.registro_treino (organization_id, aluno_id, treino_id, data, concluido, divisao, esforco_percebido, sensacao, duracao_min)
        values (${q(ORG)}, ${q(alunoId[chave])}, ${q(t)}, current_date - ${d}, true, 'A', ${6 + (d % 3)}, ${q(d % 4 === 0 ? "bom" : "otimo")}, ${45 + d})`);
      await sql(`insert into public.presencas (organization_id, aluno_id, dia, origem) values (${q(ORG)}, ${q(alunoId[chave])}, current_date - ${d}, 'qr') on conflict do nothing`);
    }
  }
  for (const chave of ["marina", "pedro"]) {
    await sql(`insert into public.presencas (organization_id, aluno_id, dia, origem) values (${q(ORG)}, ${q(alunoId[chave])}, current_date, 'qr') on conflict do nothing`);
  }

  // Check-ins.
  await sql(`insert into public.checkins (organization_id, aluno_id, status, motivo_dificuldade, comentario, data, created_at) values
    (${q(ORG)}, ${q(alunoId.marina)}, 'funcionando_bem', null, null, current_date - 1, now() - interval '1 day'),
    (${q(ORG)}, ${q(alunoId.fernanda)}, 'com_dificuldade', 'desconforto_dor', 'Senti a lombar no levantamento terra.', current_date, now() - interval '2 hours'),
    (${q(ORG)}, ${q(alunoId.lucas)}, 'preciso_ajuste', null, null, current_date - 2, now() - interval '2 days')`);

  // Fila de atendimento: uma de cada tipo comum. Dono "academia" explícito,
  // para ficarem na fila da academia mesmo para aluna do Método.
  const tarefa = (chave, tipo, prioridade, motivo, horas, extra = "") =>
    `insert into public.tarefas (organization_id, aluno_id, tipo, prioridade, motivo, status, sla_prazo, origem_evento, dono${extra ? ", responsavel_id" : ""})
     values (${q(ORG)}, ${q(alunoId[chave])}, ${q(tipo)}, ${q(prioridade)}, ${q(motivo)}, 'aberta', now() + interval '${horas} hours', ${q(`demo:${chave}:${tipo}`)}, 'academia'${extra ? `, ${q(extra)}` : ""});`;
  const [{ n: dorDoGatilho }] = await sql(`select count(*)::int n from public.tarefas where aluno_id = ${q(alunoId.fernanda)} and tipo = 'dor'`);
  await sql([
    ...(dorDoGatilho ? [] : [tarefa("fernanda", "dor", "critica", "Relatou dor na lombar no check-in de hoje", 10)]),
    tarefa("pedro", "anamnese", "alta", "Concluiu a anamnese de acolhimento", 20, ids.professor),
    tarefa("lucas", "ajuste", "media", "Pediu ajuste: o treino está longo para o horário do almoço", 30),
    tarefa("gustavo", "ativacao", "media", "Cadastrado há 3 dias e ainda não entrou no app", -4),
    tarefa("thiago", "cobranca", "alta", "Mensalidade de setembro vencida", 12),
  ].join("\n"));

  // Mensagens de treino e de nutrição, as últimas ainda não lidas.
  const msg = (chave, tipo, texto, horas, lida) =>
    `insert into public.mensagens_treino (organization_id, aluno_id, remetente_id, remetente_tipo, mensagem, lida, created_at)
     values (${q(ORG)}, ${q(alunoId[chave])}, ${q(tipo === "aluno" ? ids[chave] : ids.professor)}, ${q(tipo)}, ${q(texto)}, ${lida}, now() - interval '${horas} hours');`;
  await sql([
    msg("pedro", "treinador", "Pedro, subi a carga do supino para 3 × 8. Me conta como foi.", 30, true),
    msg("pedro", "aluno", "Fiz hoje! Consegui as 3 séries, a última foi no limite.", 3, false),
    msg("lucas", "aluno", "Posso trocar o treino de quinta para sexta essa semana?", 1, false),
    msg("marina", "aluno", "Obrigada pelas dicas do agachamento, melhorou muito!", 26, true),
  ].join("\n"));
  const dietaMarina = (await sql(`select id from public.dietas where aluno_id = ${q(alunoId.marina)} limit 1`))[0].id;
  await sql(`insert into public.mensagens_dieta (organization_id, aluno_id, dieta_id, remetente_id, remetente_tipo, mensagem, lida, created_at)
    values (${q(ORG)}, ${q(alunoId.marina)}, ${q(dietaMarina)}, ${q(ids.marina)}, 'aluno', 'No lanche posso trocar o iogurte por uma fruta?', false, now() - interval '2 hours')`);

  // Avaliações físicas: duas de cada, para mostrar evolução.
  for (const chave of ["marina", "pedro"]) {
  await sql(`insert into public.avaliacoes_fisicas (organization_id, aluno_id, avaliado_por, data_avaliacao, peso_kg, altura_cm, percentual_gordura,
      perim_cintura, perim_quadril, data_proxima_avaliacao, meta_peso_kg, meta_peso_direcao, meta_gordura_valor, meta_gordura_direcao) values
    (${q(ORG)}, ${q(alunoId[chave])}, ${q(ids.professor)}, current_date - 75, 72.4, 165, 31.5, 84, 104, current_date - 15, 69, 'diminuir', 28, 'diminuir'),
    (${q(ORG)}, ${q(alunoId[chave])}, ${q(ids.professor)}, current_date - 15, 69.8, 165, 28.9, 80, 101, current_date + 45, 67, 'diminuir', 26, 'diminuir')`);
  }

  // Planos da academia: os modelos nascem desligados; liga o mensal e o
  // trimestral, com preço de exemplo.
  await sql(`update public.planos_academia set ativo = true, valor = case periodicidade when 'mensal' then 129.9 when 'trimestral' then 359.7 else valor end
    where organization_id = ${q(ORG)} and periodicidade in ('mensal', 'trimestral')`);
  const [plano] = await sql(`select id from public.planos_academia where organization_id = ${q(ORG)} and periodicidade = 'mensal' limit 1`);
  for (const chave of ["marina", "pedro", "lucas", "fernanda", "thiago"]) {
    const [m] = await sql(`insert into public.aluno_matriculas_academia (organization_id, aluno_id, plano_id, valor_cobrado, dia_vencimento, data_inicio,
        valor_repasse_arke, valor_liquido_academia, registrado_por)
      values (${q(ORG)}, ${q(alunoId[chave])}, ${q(plano.id)}, 129.9, 10, current_date - 70, 4.37, 125.53, ${q(ids.recepcao)}) returning id`);
    const atrasada = chave === "thiago";
    await sql(`insert into public.mensalidades (organization_id, matricula_id, aluno_id, competencia, valor, vencimento, status,
        valor_repasse_arke, valor_liquido_academia) values
      (${q(ORG)}, ${q(m.id)}, ${q(alunoId[chave])}, date_trunc('month', current_date - 60)::date, 129.9, (date_trunc('month', current_date - 60) + interval '9 days')::date, 'pendente', 4.37, 125.53),
      (${q(ORG)}, ${q(m.id)}, ${q(alunoId[chave])}, date_trunc('month', current_date - 30)::date, 129.9, (date_trunc('month', current_date - 30) + interval '9 days')::date, 'pendente', 4.37, 125.53),
      (${q(ORG)}, ${q(m.id)}, ${q(alunoId[chave])}, date_trunc('month', current_date)::date, 129.9, current_date - 2, 'pendente', 4.37, 125.53)`);
    await sql(`update public.mensalidades set status = 'confirmado', data_pagamento = vencimento, forma_pagamento = case when competencia < date_trunc('month', current_date - 20) then 'pix' else 'cartao' end::public.forma_pagamento_mensalidade, taxa_gateway = 1.99
      where matricula_id = ${q(m.id)} ${atrasada ? "and competencia < date_trunc('month', current_date)" : ""}`);
    if (atrasada) await sql(`update public.mensalidades set status = 'atrasado' where matricula_id = ${q(m.id)} and status = 'pendente'`);
  }

  // Funil de vendas e comunicados.
  await sql(`insert into public.leads (organization_id, nome, telefone, origem, etapa, observacao, created_at) values
    (${q(ORG)}, 'Renata Oliveira', '(11) 98800-1101', 'Instagram', 'novo', 'Perguntou sobre horário da manhã', now() - interval '1 day'),
    (${q(ORG)}, 'Diego Martins', '(11) 98800-1102', 'Indicação', 'contato', 'Amigo do Pedro Almeida', now() - interval '3 days'),
    (${q(ORG)}, 'Patrícia Gomes', '(11) 98800-1103', 'Passou na frente', 'experimental', 'Aula experimental quinta às 19h', now() - interval '4 days'),
    (${q(ORG)}, 'Vinícius Araújo', '(11) 98800-1104', 'Google', 'negociacao', 'Quer o plano trimestral', now() - interval '6 days'),
    (${q(ORG)}, 'Beatriz Santos', '(11) 98800-1105', 'Instagram', 'matriculado', null, now() - interval '9 days')`);
  await sql(`insert into public.leads (organization_id, nome, telefone, origem, etapa, motivo_perda, created_at) values
    (${q(ORG)}, 'Rodrigo Pires', '(11) 98800-1106', 'Indicação', 'perdido', 'Horário não encaixa', now() - interval '12 days')`);
  await sql(`insert into public.comunicados (organization_id, titulo, mensagem, publico, criado_por, expira_em) values
    (${q(ORG)}, 'Feriado de 12 de outubro', 'No feriado a academia abre das 8h às 14h. Bons treinos!', 'todos', ${q(ids.gestor)}, current_date + 20)`);

  // Lançamentos manuais do mês.
  await sql(`insert into public.lancamentos_financeiros (organization_id, tipo, categoria, descricao, valor, data, vencimento, data_pagamento, status, registrado_por)
    select ${q(ORG)}, 'despesa', c, d, v, current_date - 5, current_date - 5, current_date - 5, 'pago', ${q(ids.gestor)}
      from (values ('Ocupação', 'Aluguel', 8500::numeric), ('Utilidades', 'Energia elétrica', 1320::numeric), ('Manutenção', 'Manutenção de esteiras', 450::numeric)) as x(c, d, v)`);

  // Aceite dos documentos vigentes, para as telas abrirem direto.
  const docs = await sql(`select distinct on (tipo) id, tipo from public.documentos_legais order by tipo, versao desc`);
  const aceites = [];
  for (const p of pessoas) {
    for (const d of docs) {
      if (d.tipo === "contrato_academia" && p.papel !== "gestor") continue;
      aceites.push(`(${q(d.id)}, ${q(ids[p.chave])}, ${d.tipo === "contrato_academia" ? q(ORG) : "null"}, 'demonstração da Central de Ajuda')`);
    }
  }
  await sql(`insert into public.aceites_documentos (documento_id, user_id, organization_id, user_agent) values ${aceites.join(",")}`);

  const sessoes = {};
  for (const p of [...EQUIPE, ...ALUNOS.filter((a) => ["marina", "pedro"].includes(a.chave))]) sessoes[p.chave] = await sessao(`${p.chave}@${DOMINIO}`);
  writeFileSync(SESSOES, JSON.stringify({ organizacao: ORG, alunos: alunoId, sessoes }, null, 2));
  console.log(`pronto: ${EQUIPE.length} pessoas na equipe, ${ALUNOS.length} alunos; sessões em ${SESSOES}`);
}

async function limpar() {
  const ORG = await orgDemo();
  const contas = await sql(`select id from auth.users where email like ${q(`%@${DOMINIO}`)}`);
  if (ORG) {
    // Sem cobrança viva no gateway (trial nunca foi ao Asaas): a trava de
    // exclusão de aluno não tem o que barrar.
    await sql(`delete from public.organizations where id = ${q(ORG)}`);
    console.log("organização apagada");
  }
  for (const c of contas) await admin(`/admin/users/${c.id}`, { method: "DELETE" });
  console.log(`${contas.length} contas apagadas`);
  const [sa] = await sql(`select user_id from public.user_roles where role = 'superadmin' limit 1`);
  // A API de consultas devolve só o resultado da primeira instrução: a
  // identidade entra numa CTE da qual a varredura depende.
  const orfaos = await sql(`with c as materialized (select set_config('request.jwt.claims', json_build_object('sub', ${q(sa.user_id)}, 'role', 'authenticated', 'aal', 'aal2')::text, true) as x)
    select v.tabela, v.orfaos from c cross join lateral (select * from public.verificar_orfaos() where c.x is not null) v where v.orfaos > 0`).catch((e) => (console.log("conferência de órfãos não rodou:", e.message.slice(0, 160)), null));
  if (orfaos) console.log(orfaos.length ? `ATENÇÃO, órfãos: ${JSON.stringify(orfaos)}` : "nenhuma linha órfã");
  if (existsSync(SESSOES)) unlinkSync(SESSOES);
}

const comando = process.argv[2];
if (comando === "semear") await semear();
else if (comando === "limpar") await limpar();
else console.log("uso: node scripts/ajuda/demonstracao.mjs semear|limpar");

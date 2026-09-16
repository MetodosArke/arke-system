import {
  type Desafio,
  getAlunoObjetivosRecente,
  getAlunoPerfil,
  getAlunoValoresRecente,
  listAlunosComArkeAtivoIds,
  listAvaliacoesSemanaisPeriodo,
  listCheckinsPeriodo,
  listCompromissoMetasPeriodo,
  listDesafioParticipantesForAluno,
  listDesafioProgressoForAluno,
  listDesafios,
  listDietaAdesaoPeriodo,
  listFeedCommentsPeriodoAluno,
  listFeedLikesPeriodoAluno,
  listFeedPostsPeriodoAluno,
  listProgressoSemanalPeriodo,
  listTreinoCalendarioPeriodo,
} from "./supabaseAdmin";

// Motor de pontuação do Módulo Arke — porte fiel da fórmula do arke-app
// original (usePontuacaoMensal.ts), adaptado de "mês calendário" para um
// período [desde, ate] arbitrário (mesma assinatura já usada por
// arke.meu.minhaPontuacao/comparativo e prescricao.pontuacao.deAluno).
// Cada ponto vem de um evento real já registrado — nunca uma heurística
// inventada (CLAUDE.md §6). `registro_treino` (tabela legada de série por
// série) continua fora: nunca foi religada, não tem escrita em nenhuma
// tela, e tratá-la como sempre vazia é honesto — treino_calendario já
// cobre "o aluno registrou que treinou".

function weekKeyFor(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const diffToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

function addDaysStr(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDiasStr(a: string, b: string) {
  const da = new Date(`${a}T00:00:00.000Z`).getTime();
  const db = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((da - db) / 86400000);
}

type Semana = { inicio: string; fim: string };
function getSemanasNoPeriodo(desde: string, ate: string): Semana[] {
  const semanas: Semana[] = [];
  let cursor = weekKeyFor(desde);
  while (cursor <= ate) {
    semanas.push({ inicio: cursor, fim: addDaysStr(cursor, 6) });
    cursor = addDaysStr(cursor, 7);
  }
  return semanas;
}

// Maior sequência de semanas verdadeiras em `weeklyHits`, convertida em
// bônus por limiar (bonusTable[i] vale a partir de uma sequência de i+2
// semanas). Idêntico ao calcStreakBonus do arke-app original.
function calcStreakBonus(weeklyHits: boolean[], bonusTable: number[]): number {
  let streak = 0;
  let maxStreak = 0;
  for (const hit of weeklyHits) {
    if (hit) { streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
  }
  let bonus = 0;
  for (let i = bonusTable.length - 1; i >= 0; i--) {
    if (maxStreak >= i + 2) { bonus = bonusTable[i]; break; }
  }
  return bonus;
}

const MODALIDADES_RASTREADAS = ["natação", "ciclismo", "corrida"];

type SubMetrica = { base: number; bonus: number; total: number; max: number };

export type PontuacaoDetalhada = {
  engajamento: {
    dedicacaoDiaria: SubMetrica;
    progressoSemanal: SubMetrica;
    objetivos: { total: number; max: number };
    valores: { total: number; max: number };
    compromissosCriados: SubMetrica;
    feed: { total: number; max: number };
    calendarioDieta: { total: number; max: number };
    total: number;
  };
  performance: {
    metaTreino: SubMetrica;
    modalidades: { total: number; count: number; max: number };
    dietaSemanal: SubMetrica;
    metasMes: { total: number; metasBatidas: number; metasNaoAtingidas: number; max: number };
    conquistaSemanal: SubMetrica;
    compromissoCumprido: SubMetrica;
    agua: SubMetrica;
    desafios: { total: number; max: number };
    penalidade: { total: number; diasAlcool: number };
    total: number;
  };
  total: number;
};

// Tipos de desafio calculados automaticamente a partir de dado já
// registrado pelo aluno (sem_doce/sem_alcool são invertidos: quanto menos
// dias com o hábito, melhor). "livre" nunca é automático — só a equipe
// valida (comportamento preservado, mesma regra de prescricao.desafios).
export type CalcAutoResultado = { valor: number; meta: number; isInverse: boolean };
export async function calcAuto(alunoId: string, desafio: Desafio): Promise<CalcAutoResultado | null> {
  const meta = desafio.meta_valor ?? 0;
  switch (desafio.tipo) {
    case "sem_doce": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.filter((d) => d.consumiu_doce).length, meta, isInverse: true };
    }
    case "sem_alcool": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.filter((d) => d.consumiu_alcool).length, meta, isInverse: true };
    }
    case "consumo_agua": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.reduce((soma, d) => soma + (d.agua_ml ?? 0), 0), meta, isInverse: false };
    }
    case "numero_treinos": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: treinos.length, meta, isInverse: false };
    }
    case "quilometros": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: treinos.reduce((soma, t) => soma + (t.distancia_km ?? 0), 0), meta, isInverse: false };
    }
    case "modalidades": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      const tipos = new Set<string>();
      for (const treino of treinos) for (const tipo of treino.tipos) tipos.add(tipo);
      return { valor: tipos.size, meta, isInverse: false };
    }
    case "desempenho_dieta": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      const media = dietas.length ? dietas.reduce((soma, d) => soma + d.adesao_percentual, 0) / dietas.length : 0;
      return { valor: Math.round(media), meta, isInverse: false };
    }
    default:
      return null;
  }
}

// Desafios que terminam dentro do período contam pontos integralmente:
// conclusão manual (desafio_progresso.concluido, sempre digitada pela
// equipe) tem prioridade; sem isso, calcAuto decide a partir do dado
// registrado — sem_doce/sem_alcool só fecham quando o desafio já encerrou
// (para não julgar hábito de um período incompleto).
async function pontosDesafios(alunoId: string, organizationId: string, desde: string, ate: string, hoje: string) {
  const [desafiosOrg, participacoes, progresso] = await Promise.all([
    listDesafios(organizationId),
    listDesafioParticipantesForAluno(alunoId),
    listDesafioProgressoForAluno(alunoId),
  ]);
  const participandoIds = new Set(participacoes.map((p) => p.desafio_id));
  const progressoByDesafio = new Map(progresso.map((dp) => [dp.desafio_id, dp]));
  const aplicaveis = desafiosOrg.filter((d) => d.para_todos || participandoIds.has(d.id));
  const noPeriodo = aplicaveis.filter((d) => d.data_fim >= desde && d.data_fim <= ate);

  const pontosPorDesafio = await Promise.all(noPeriodo.map(async (desafio) => {
    if (progressoByDesafio.get(desafio.id)?.concluido) return desafio.pontos;
    const auto = await calcAuto(alunoId, desafio);
    if (!auto) return 0;
    const encerrado = desafio.data_fim < hoje;
    const concluido = auto.isInverse ? auto.valor <= auto.meta && encerrado : auto.meta > 0 && auto.valor >= auto.meta;
    return concluido ? desafio.pontos : 0;
  }));
  return Math.min(pontosPorDesafio.reduce((soma, pontos) => soma + pontos, 0), 20);
}

export async function computeScoreAluno(alunoId: string, organizationId: string, desde: string, ate: string): Promise<PontuacaoDetalhada> {
  const semanas = getSemanasNoPeriodo(desde, ate);
  const hoje = new Date().toISOString().slice(0, 10);

  const [
    checkins, avaliacoes, objetivosRow, valoresRow, compromissoMetas,
    feedPosts, feedLikes, feedComments, dietaAdesao, treinos,
    alunoPerfil, progressosPeriodo, desafiosTotal,
  ] = await Promise.all([
    listCheckinsPeriodo(alunoId, desde, ate),
    listAvaliacoesSemanaisPeriodo(alunoId, desde, ate),
    getAlunoObjetivosRecente(alunoId),
    getAlunoValoresRecente(alunoId),
    listCompromissoMetasPeriodo(alunoId, desde, ate),
    listFeedPostsPeriodoAluno(alunoId, desde, ate),
    listFeedLikesPeriodoAluno(alunoId, desde, ate),
    listFeedCommentsPeriodoAluno(alunoId, desde, ate),
    listDietaAdesaoPeriodo(alunoId, desde, ate),
    listTreinoCalendarioPeriodo(alunoId, desde, ate),
    getAlunoPerfil(alunoId),
    listProgressoSemanalPeriodo(alunoId, desde, ate),
    pontosDesafios(alunoId, organizationId, desde, ate, hoje),
  ]);

  // ===== Engajamento (máx. 100) =====

  const diasPreenchidos = Math.min(checkins.length, 15);
  let maxConsecDias = 0;
  let streakAtual = 0;
  const datasOrdenadas = checkins.map((c) => c.data).sort();
  datasOrdenadas.forEach((data, i) => {
    streakAtual = i === 0 ? 1 : (diffDiasStr(data, datasOrdenadas[i - 1]) === 1 ? streakAtual + 1 : 1);
    maxConsecDias = Math.max(maxConsecDias, streakAtual);
  });
  const dedicacaoBonus = Math.min(Math.floor(maxConsecDias / 2), 10);
  const dedicacaoDiaria: SubMetrica = { base: diasPreenchidos, bonus: dedicacaoBonus, total: Math.min(diasPreenchidos + dedicacaoBonus, 25), max: 25 };

  const weeklyAvaliacao = semanas.map((w) => avaliacoes.some((a) => a.semana === w.inicio));
  const progressoBase = Math.min(weeklyAvaliacao.filter(Boolean).length * 3, 12);
  const progressoBonus = calcStreakBonus(weeklyAvaliacao, [1, 2, 3]);
  const progressoSemanal: SubMetrica = { base: progressoBase / 3, bonus: progressoBonus, total: Math.min(progressoBase + progressoBonus, 15), max: 15 };

  let objetivosTotal = 0;
  if (objetivosRow) {
    const valido = !objetivosRow.proxima_revisao || objetivosRow.proxima_revisao >= desde;
    if (valido) {
      const count = objetivosRow.objetivos.filter((o) => o?.trim()).length;
      objetivosTotal = count >= 3 ? 10 : count === 2 ? 7 : count === 1 ? 4 : 0;
    }
  }

  let valoresTotal = 0;
  if (valoresRow && valoresRow.valores.length >= 3) {
    const valido = !valoresRow.validade || valoresRow.validade >= desde;
    if (valido) valoresTotal = 10;
  }

  const weeklyCompromissoCount = semanas.map((w) => Math.min(compromissoMetas.filter((m) => m.compromisso_semanal.semana === w.inicio).length, 3));
  const compromissosBase = Math.min(weeklyCompromissoCount.reduce((soma, v) => soma + v, 0), 12);
  const weeklyCompHit = weeklyCompromissoCount.map((v) => v > 0);
  let compStreak = 0;
  let compMaxStreak = 0;
  for (const hit of weeklyCompHit) { if (hit) { compStreak++; compMaxStreak = Math.max(compMaxStreak, compStreak); } else compStreak = 0; }
  const compBonus = compMaxStreak >= 6 ? 3 : compMaxStreak >= 4 ? 2 : compMaxStreak >= 2 ? 1 : 0;
  const compromissosCriados: SubMetrica = { base: compromissosBase, bonus: compBonus, total: Math.min(compromissosBase + compBonus, 15), max: 15 };

  const feedWeekly = semanas.map((w) => {
    const naSemana = (createdAt: string) => { const dia = createdAt.slice(0, 10); return dia >= w.inicio && dia <= w.fim; };
    return feedPosts.some((p) => naSemana(p.created_at)) || feedLikes.some((l) => naSemana(l.created_at)) || feedComments.some((c) => naSemana(c.created_at));
  });
  const feedTotal = Math.min(feedWeekly.filter(Boolean).length, 5);

  let calendarioDietaTotal = 0;
  for (const dieta of dietaAdesao) calendarioDietaTotal += diffDiasStr(dieta.created_at.slice(0, 10), dieta.data) === 0 ? 1 : 0.5;
  calendarioDietaTotal = Math.min(Math.floor(calendarioDietaTotal), 20);

  const engajamentoTotal = Math.min(dedicacaoDiaria.total + progressoSemanal.total + objetivosTotal + valoresTotal + compromissosCriados.total + feedTotal + calendarioDietaTotal, 100);

  // ===== Performance (máx. 100) =====

  const metaSemanal = alunoPerfil?.meta_semanal_dias ?? 3;
  const weeklyTreinoHit = semanas.map((w) => treinos.filter((t) => t.data >= w.inicio && t.data <= w.fim).length >= metaSemanal);
  const treinoBase = Math.min(weeklyTreinoHit.filter(Boolean).length * 3, 12);
  const treinoBonus = calcStreakBonus(weeklyTreinoHit, [1, 2, 3]);
  const metaTreino: SubMetrica = { base: treinoBase / 3, bonus: treinoBonus, total: Math.min(treinoBase + treinoBonus, 15), max: 15 };

  const modalidadesSet = new Set<string>();
  for (const treino of treinos) for (const tipo of treino.tipos) { const lower = tipo.toLowerCase(); if (MODALIDADES_RASTREADAS.includes(lower)) modalidadesSet.add(lower); }
  const modalidadesCount = modalidadesSet.size;
  const modalidadesTotal = modalidadesCount >= 3 ? 5 : modalidadesCount === 2 ? 3 : modalidadesCount === 1 ? 2 : 0;

  const weeklyDietaHit = semanas.map((w) => {
    const semanaDieta = dietaAdesao.filter((d) => d.data >= w.inicio && d.data <= w.fim);
    if (!semanaDieta.length) return false;
    return semanaDieta.reduce((soma, d) => soma + d.adesao_percentual, 0) / semanaDieta.length >= 80;
  });
  const dietaBase = Math.min(weeklyDietaHit.filter(Boolean).length * 3, 12);
  const dietaBonus = calcStreakBonus(weeklyDietaHit, [1, 2, 3]);
  const dietaSemanal: SubMetrica = { base: dietaBase / 3, bonus: dietaBonus, total: Math.min(dietaBase + dietaBonus, 15), max: 15 };

  let metasNaoAtingidas = 0;
  let metasBatidas = 0;
  if (progressosPeriodo.length > 0) {
    const latest = progressosPeriodo[0];
    const checkMeta = (atual: number | null, alvo: number | null, dir: string | null, tolerancia: number) => {
      if (atual == null || alvo == null || !dir) return;
      let atingida = false;
      if (dir === "diminuir") atingida = atual <= alvo;
      else if (dir === "aumentar") atingida = atual >= alvo;
      else if (dir === "manter") atingida = Math.abs(atual - alvo) <= tolerancia;
      if (atingida) metasBatidas++; else metasNaoAtingidas++;
    };
    checkMeta(latest.peso_kg, latest.meta_peso_kg, latest.meta, 1);
    checkMeta(latest.gordura_percentual, latest.meta_gordura_valor, latest.meta_gordura, 0.5);
    checkMeta(latest.musculo_percentual, latest.meta_musculo_valor, latest.meta_musculo, 0.5);
  }
  const metasMesTotal = metasNaoAtingidas === 1 ? 16 : metasNaoAtingidas === 2 ? 7 : metasNaoAtingidas >= 3 ? 0 : 25;

  const weeklyConquista = semanas.map((w) => avaliacoes.some((a) => a.semana === w.inicio && a.conquista?.trim()));
  const conquistaBase = Math.min(weeklyConquista.filter(Boolean).length * 2, 8);
  const conquistaBonus = calcStreakBonus(weeklyConquista, [1, 2]);
  const conquistaSemanal: SubMetrica = { base: conquistaBase / 2, bonus: conquistaBonus, total: Math.min(conquistaBase + conquistaBonus, 10), max: 10 };

  const weeklyCompCumprido = semanas.map((w) => compromissoMetas.some((m) => m.compromisso_semanal.semana === w.inicio && m.concluida));
  const compCumpridoBase = Math.min(weeklyCompCumprido.filter(Boolean).length * 2, 8);
  const compCumpridoBonus = calcStreakBonus(weeklyCompCumprido, [1, 2]);
  const compromissoCumprido: SubMetrica = { base: compCumpridoBase / 2, bonus: compCumpridoBonus, total: Math.min(compCumpridoBase + compCumpridoBonus, 10), max: 10 };

  const weeklyAgua = semanas.map((w) => {
    const semanaDieta = dietaAdesao.filter((d) => d.data >= w.inicio && d.data <= w.fim);
    if (!semanaDieta.length) return false;
    return semanaDieta.reduce((soma, d) => soma + (d.agua_ml ?? 0), 0) / semanaDieta.length >= 1500;
  });
  const aguaBase = Math.min(weeklyAgua.filter(Boolean).length, 4);
  const aguaBonus = weeklyAgua.filter(Boolean).length >= 2 ? 1 : 0;
  const agua: SubMetrica = { base: aguaBase, bonus: aguaBonus, total: Math.min(aguaBase + aguaBonus, 5), max: 5 };

  const diasAlcool = dietaAdesao.filter((d) => d.consumiu_alcool).length;
  const penalidadeTotal = diasAlcool * 5;

  const performanceTotal = Math.max(0, Math.min(metaTreino.total + dietaSemanal.total + metasMesTotal + conquistaSemanal.total + compromissoCumprido.total + agua.total + desafiosTotal + modalidadesTotal - penalidadeTotal, 100));

  return {
    engajamento: {
      dedicacaoDiaria, progressoSemanal,
      objetivos: { total: objetivosTotal, max: 10 },
      valores: { total: valoresTotal, max: 10 },
      compromissosCriados, feed: { total: feedTotal, max: 5 }, calendarioDieta: { total: calendarioDietaTotal, max: 20 },
      total: engajamentoTotal,
    },
    performance: {
      metaTreino, modalidades: { total: modalidadesTotal, count: modalidadesCount, max: 5 }, dietaSemanal,
      metasMes: { total: metasMesTotal, metasBatidas, metasNaoAtingidas, max: 25 },
      conquistaSemanal, compromissoCumprido, agua,
      desafios: { total: desafiosTotal, max: 20 },
      penalidade: { total: penalidadeTotal, diasAlcool },
      total: performanceTotal,
    },
    total: engajamentoTotal + performanceTotal,
  };
}

// Comparação relativa (Sessão A, fatia 3): a pontuação do aluno nunca é
// comparada com a de um colega específico fora do contexto de competição
// — só com a média do grupo (todos os alunos com Arke ativo da
// organização), sem expor quem tem quanto.
export async function computeComparativoAluno(alunoId: string, organizationId: string, desde: string, ate: string) {
  const alunoIds = await listAlunosComArkeAtivoIds(organizationId);
  const scores = await Promise.all(alunoIds.map((id) => computeScoreAluno(id, organizationId, desde, ate)));
  const tamanhoGrupo = alunoIds.length;
  const mediaGrupo = tamanhoGrupo ? scores.reduce((soma, score) => soma + score.total, 0) / tamanhoGrupo : 0;
  const indiceAluno = alunoIds.indexOf(alunoId);
  const minhaPontuacao = indiceAluno >= 0 ? scores[indiceAluno].total : (await computeScoreAluno(alunoId, organizationId, desde, ate)).total;
  return { minhaPontuacao, mediaGrupo, tamanhoGrupo };
}

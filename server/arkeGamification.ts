import { getDesafio, getPlanoTreinoSemanal, listAvaliacoesSemanaisPeriodo, listCheckinsPeriodo, listCompromissoMetasConcluidasPeriodo, listDesafioProgressoForAluno, listDietaAdesaoPeriodo, listProgressoSemanal, listTreinoCalendarioPeriodo } from "./supabaseAdmin";

// Motor de pontuação do Módulo Arke (Sessão A, fatia 2 — checkpoint a
// validar com o usuário antes de ligar em desafios/competições
// automáticos). Cada ponto vem de um evento real já registrado —
// checkin_diario, avaliacao_semanal, treino_calendario, dieta_adesao,
// compromisso_metas, desafio_progresso — nunca uma heurística inventada
// (CLAUDE.md §6). Constantes fixas por enquanto (decisão D-A5: pontuação
// configurável por organização fica para depois, se necessário na prática).
const PONTOS_POR_EVENTO_ENGAJAMENTO = 5;
const PONTOS_META_PESO_ATINGIDA = 20;
const TOLERANCIA_META_PESO_KG = 1;
const PONTOS_META_TREINOS_SEMANA = 15;

// Mesma lógica de currentWeekKey() em routers.ts, mas para uma data
// qualquer (não "hoje") — segunda-feira da semana daquela data.
function weekKeyFor(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const diffToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

export type PontoEvento = { origem: "engajamento" | "meta" | "desafio"; descricao: string; pontos: number; data: string };

// Engajamento: pontua pelo preenchimento em si (fez o check-in, registrou
// o treino, marcou a micrometa) — nunca pela "qualidade" do valor.
async function pontosEngajamento(alunoId: string, desde: string, ate: string): Promise<PontoEvento[]> {
  const [checkins, avaliacoes, treinos, dietaAdesoes, metasConcluidas] = await Promise.all([
    listCheckinsPeriodo(alunoId, desde, ate),
    listAvaliacoesSemanaisPeriodo(alunoId, desde, ate),
    listTreinoCalendarioPeriodo(alunoId, desde, ate),
    listDietaAdesaoPeriodo(alunoId, desde, ate),
    listCompromissoMetasConcluidasPeriodo(alunoId, desde, ate),
  ]);
  const eventos: PontoEvento[] = [];
  for (const checkin of checkins) eventos.push({ origem: "engajamento", descricao: "Check-in diário", pontos: PONTOS_POR_EVENTO_ENGAJAMENTO, data: checkin.data });
  for (const avaliacao of avaliacoes) eventos.push({ origem: "engajamento", descricao: "Avaliação semanal", pontos: PONTOS_POR_EVENTO_ENGAJAMENTO, data: avaliacao.semana });
  for (const treino of treinos) eventos.push({ origem: "engajamento", descricao: `Treino registrado (${treino.tipos.join(", ")})`, pontos: PONTOS_POR_EVENTO_ENGAJAMENTO, data: treino.data });
  for (const dieta of dietaAdesoes) eventos.push({ origem: "engajamento", descricao: "Adesão à dieta registrada", pontos: PONTOS_POR_EVENTO_ENGAJAMENTO, data: dieta.data });
  for (const meta of metasConcluidas) eventos.push({ origem: "engajamento", descricao: `Micrometa concluída: ${meta.texto}`, pontos: PONTOS_POR_EVENTO_ENGAJAMENTO, data: meta.compromisso_semanal.semana });
  return eventos;
}

// Metas: peso (definido pelo profissional em progresso_semanal.meta_peso_kg)
// e meta operacional de treinos/semana (plano_treino_semanal.dias_treino
// vs. dias distintos com treino_calendario naquela semana).
async function pontosMetas(alunoId: string, desde: string, ate: string): Promise<PontoEvento[]> {
  const eventos: PontoEvento[] = [];
  const [progresso, plano, treinos] = await Promise.all([listProgressoSemanal(alunoId), getPlanoTreinoSemanal(alunoId), listTreinoCalendarioPeriodo(alunoId, desde, ate)]);

  const progressoNoPeriodo = progresso.filter((registro) => registro.data >= desde && registro.data <= ate);
  const maisRecente = progressoNoPeriodo[progressoNoPeriodo.length - 1];
  if (maisRecente?.meta_peso_kg != null && maisRecente.peso_kg != null && Math.abs(maisRecente.peso_kg - maisRecente.meta_peso_kg) <= TOLERANCIA_META_PESO_KG) {
    eventos.push({ origem: "meta", descricao: `Meta de peso atingida (${maisRecente.peso_kg}kg, meta ${maisRecente.meta_peso_kg}kg)`, pontos: PONTOS_META_PESO_ATINGIDA, data: maisRecente.data });
  }

  if (plano?.dias_treino?.length) {
    const diasPorSemana = new Map<string, Set<string>>();
    for (const treino of treinos) {
      const semana = weekKeyFor(treino.data);
      if (!diasPorSemana.has(semana)) diasPorSemana.set(semana, new Set());
      diasPorSemana.get(semana)?.add(treino.data);
    }
    const metaDiasPorSemana = plano.dias_treino.length;
    diasPorSemana.forEach((dias, semana) => {
      if (dias.size >= metaDiasPorSemana) eventos.push({ origem: "meta", descricao: `Meta semanal de treinos atingida (${dias.size}/${metaDiasPorSemana})`, pontos: PONTOS_META_TREINOS_SEMANA, data: semana });
    });
  }

  return eventos;
}

// Desafios concluídos no período — competições não entram aqui: têm seu
// próprio ranking em competicao_pontuacao, separado da pontuação pessoal.
async function pontosDesafios(alunoId: string, desde: string, ate: string): Promise<PontoEvento[]> {
  const progresso = await listDesafioProgressoForAluno(alunoId);
  const eventos: PontoEvento[] = [];
  for (const item of progresso) {
    if (!item.concluido || !item.concluido_em) continue;
    const data = item.concluido_em.slice(0, 10);
    if (data < desde || data > ate) continue;
    const desafio = await getDesafio(item.desafio_id);
    if (desafio) eventos.push({ origem: "desafio", descricao: `Desafio concluído: ${desafio.titulo}`, pontos: desafio.pontos, data });
  }
  return eventos;
}

export async function computeScoreAluno(alunoId: string, _organizationId: string, desde: string, ate: string) {
  const [engajamento, metas, desafios] = await Promise.all([pontosEngajamento(alunoId, desde, ate), pontosMetas(alunoId, desde, ate), pontosDesafios(alunoId, desde, ate)]);
  const eventos = [...engajamento, ...metas, ...desafios].sort((a, b) => a.data.localeCompare(b.data));
  const total = eventos.reduce((soma, evento) => soma + evento.pontos, 0);
  return { eventos, total };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { computeComparativoAluno, computeScoreAluno } from "./arkeGamification";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const ALUNO_ID = "aluno-1";
const ORG_ID = "org-1";
const DESDE = "2020-09-01";
const ATE = "2020-09-30";
// Semanas (segunda-domingo) que cobrem o período acima.
const W1 = "2020-08-31";
const W2 = "2020-09-07";
const W3 = "2020-09-14";
const W4 = "2020-09-21";
const W5 = "2020-09-28";

function mockVazio() {
  vi.spyOn(supabaseAdmin, "listCheckinsPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listAvaliacoesSemanaisPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "getAlunoObjetivosRecente").mockResolvedValue(null);
  vi.spyOn(supabaseAdmin, "getAlunoValoresRecente").mockResolvedValue(null);
  vi.spyOn(supabaseAdmin, "listCompromissoMetasPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listFeedPostsPeriodoAluno").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listFeedLikesPeriodoAluno").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listFeedCommentsPeriodoAluno").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "getAlunoPerfil").mockResolvedValue(null);
  vi.spyOn(supabaseAdmin, "listProgressoSemanalPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listDesafioParticipantesForAluno").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listDesafioProgressoForAluno").mockResolvedValue([]);
}

function checkin(data: string): supabaseAdmin.CheckinDiario {
  return { id: `c-${data}`, user_id: ALUNO_ID, organization_id: ORG_ID, data, dedicacao: "boa", horas_sono: null, created_at: "" };
}

function avaliacao(semana: string, conquista: string | null = null): supabaseAdmin.AvaliacaoSemanal {
  return { id: `a-${semana}`, user_id: ALUNO_ID, organization_id: ORG_ID, semana, sono: 7, produtividade: 7, humor: 7, conquista, created_at: "", updated_at: "" };
}

function treino(data: string, tipos: string[], distanciaKm: number | null = null): supabaseAdmin.TreinoCalendario {
  return { id: `t-${data}-${tipos.join()}`, aluno_id: ALUNO_ID, organization_id: ORG_ID, data, tipos, duracao_min: 60, distancia_km: distanciaKm, intensidade: "moderada", detalhes: null, observacoes: null, created_at: "" };
}

function dieta(data: string, overrides: Partial<supabaseAdmin.DietaAdesao> = {}): supabaseAdmin.DietaAdesao {
  return { id: `d-${data}`, aluno_id: ALUNO_ID, dieta_id: "dieta-1", organization_id: ORG_ID, data, adesao_percentual: 90, consumiu_doce: false, consumiu_alcool: false, agua_ml: 2000, observacoes: null, created_at: `${data}T10:00:00.000Z`, ...overrides };
}

function compromissoMeta(semana: string, concluida: boolean): supabaseAdmin.CompromissoMeta & { compromisso_semanal: { semana: string } } {
  return { id: `m-${semana}-${Math.random()}`, compromisso_id: "cp1", texto: "meta", objetivo_vinculado: null, valor_vinculado: null, concluida, created_at: "", compromisso_semanal: { semana } };
}

function progresso(overrides: Partial<supabaseAdmin.ProgressoSemanal>): supabaseAdmin.ProgressoSemanal {
  return { id: "p1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2020-09-15", peso_kg: null, gordura_percentual: null, musculo_percentual: null, cintura_cm: null, quadril_cm: null, braco_cm: null, perna_cm: null, bem_estar: null, observacoes: null, meta_peso_kg: null, meta: null, meta_gordura: null, meta_gordura_valor: null, meta_musculo: null, meta_musculo_valor: null, created_at: "", ...overrides };
}

describe("computeScoreAluno — estado vazio", () => {
  it("zera o engajamento, mas metasMes começa em 25 quando não há aferição para penalizar", async () => {
    mockVazio();
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.total).toBe(0);
    // Fidelidade ao original: metasMes só desconta quando há uma meta com
    // aferição registrada que não foi atingida — sem nenhum progresso_semanal
    // no período não há o que penalizar, então o valor de partida (25) fica.
    expect(result.performance.metasMes).toEqual({ total: 25, metasBatidas: 0, metasNaoAtingidas: 0, max: 25 });
    expect(result.performance.total).toBe(25);
    expect(result.total).toBe(25);
  });
});

describe("computeScoreAluno — engajamento", () => {
  it("dedicacaoDiaria soma dias preenchidos + bônus de sequência consecutiva", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listCheckinsPeriodo").mockResolvedValue([checkin("2020-09-07"), checkin("2020-09-08"), checkin("2020-09-09"), checkin("2020-09-10"), checkin("2020-09-11")]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // 5 dias preenchidos + bônus min(floor(5/2),10)=2.
    expect(result.engajamento.dedicacaoDiaria).toEqual({ base: 5, bonus: 2, total: 7, max: 25 });
  });

  it("progressoSemanal pontua semanas com avaliação e bonifica sequência", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAvaliacoesSemanaisPeriodo").mockResolvedValue([avaliacao(W2), avaliacao(W3), avaliacao(W4)]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // 3 semanas * 3 = 9 base; sequência de 3 semanas -> bônus 2 (limiar >=3).
    expect(result.engajamento.progressoSemanal).toEqual({ base: 3, bonus: 2, total: 11, max: 15 });
  });

  it("objetivos pontua por faixa de quantidade e respeita a validade da revisão", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "getAlunoObjetivosRecente").mockResolvedValue({ id: "o1", user_id: ALUNO_ID, organization_id: ORG_ID, objetivos: ["a", "b", "c"], conquistas: null, dificuldades: null, visao_3_meses: null, visao_3_anos: null, proxima_revisao: null, created_at: "" });
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.objetivos).toEqual({ total: 10, max: 10 });
  });

  it("objetivos não pontua quando a próxima revisão já venceu antes do período", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "getAlunoObjetivosRecente").mockResolvedValue({ id: "o1", user_id: ALUNO_ID, organization_id: ORG_ID, objetivos: ["a", "b", "c"], conquistas: null, dificuldades: null, visao_3_meses: null, visao_3_anos: null, proxima_revisao: "2020-01-01", created_at: "" });
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.objetivos.total).toBe(0);
  });

  it("valores exige pelo menos 3 valores vigentes para pontuar", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "getAlunoValoresRecente").mockResolvedValue({ id: "v1", user_id: ALUNO_ID, organization_id: ORG_ID, valores: ["Saúde", "Família", "Disciplina"], validade: null, created_at: "" });
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.valores).toEqual({ total: 10, max: 10 });
  });

  it("compromissosCriados soma metas por semana (até 3) e bonifica sequência de semanas com meta", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listCompromissoMetasPeriodo").mockResolvedValue([compromissoMeta(W2, false), compromissoMeta(W2, false), compromissoMeta(W3, true)]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // W2: min(2,3)=2, W3: min(1,3)=1 -> base 3; sequência de 2 semanas seguidas -> bônus 1.
    expect(result.engajamento.compromissosCriados).toEqual({ base: 3, bonus: 1, total: 4, max: 15 });
  });

  it("feed conta semanas com pelo menos 1 post/curtida/comentário do aluno", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listFeedPostsPeriodoAluno").mockResolvedValue([{ created_at: "2020-09-08T12:00:00.000Z" }]);
    vi.spyOn(supabaseAdmin, "listFeedLikesPeriodoAluno").mockResolvedValue([{ created_at: "2020-09-16T12:00:00.000Z" }]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.feed).toEqual({ total: 2, max: 5 });
  });

  it("calendarioDieta pontua 1 quando registrado no mesmo dia e 0.5 quando registrado depois", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([
      dieta("2020-09-07", { created_at: "2020-09-07T20:00:00.000Z" }),
      dieta("2020-09-08", { created_at: "2020-09-09T08:00:00.000Z" }),
    ]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.engajamento.calendarioDieta).toEqual({ total: 1, max: 20 }); // floor(1 + 0.5) = 1
  });
});

describe("computeScoreAluno — performance", () => {
  it("metaTreino compara dias registrados na semana com a meta operacional do aluno", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "getAlunoPerfil").mockResolvedValue({ id: "perfil-1", user_id: ALUNO_ID, organization_id: ORG_ID, meta_semanal_dias: 2 });
    vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([treino("2020-09-07", ["Musculação"]), treino("2020-09-08", ["Corrida"])]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.metaTreino).toEqual({ base: 1, bonus: 0, total: 3, max: 15 });
  });

  it("modalidades pontua por número de modalidades rastreadas distintas no período", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([treino("2020-09-07", ["Natação"]), treino("2020-09-08", ["Ciclismo"])]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.modalidades).toEqual({ total: 3, count: 2, max: 5 });
  });

  it("dietaSemanal pontua semanas com adesão média >= 80%", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([dieta("2020-09-07", { adesao_percentual: 85 }), dieta("2020-09-08", { adesao_percentual: 90 })]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.dietaSemanal).toEqual({ base: 1, bonus: 0, total: 3, max: 15 });
  });

  it("metasMes começa em 25 e desconta por meta não atingida no registro mais recente do período", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listProgressoSemanalPeriodo").mockResolvedValue([progresso({ data: "2020-09-20", peso_kg: 85, meta_peso_kg: 80, meta: "diminuir" })]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.metasMes).toEqual({ total: 16, metasBatidas: 0, metasNaoAtingidas: 1, max: 25 });
  });

  it("metasMes mantém 25 quando a meta de peso é atingida dentro da tolerância", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listProgressoSemanalPeriodo").mockResolvedValue([progresso({ data: "2020-09-20", peso_kg: 79, meta_peso_kg: 80, meta: "diminuir" })]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.metasMes).toEqual({ total: 25, metasBatidas: 1, metasNaoAtingidas: 0, max: 25 });
  });

  it("conquistaSemanal só conta semanas com avaliação preenchida com conquista não vazia", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAvaliacoesSemanaisPeriodo").mockResolvedValue([avaliacao(W2, "Corri 5km"), avaliacao(W3, "  "), avaliacao(W4, null)]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.conquistaSemanal).toEqual({ base: 1, bonus: 0, total: 2, max: 10 });
  });

  it("compromissoCumprido conta semanas com pelo menos 1 meta marcada como concluída", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listCompromissoMetasPeriodo").mockResolvedValue([compromissoMeta(W2, true), compromissoMeta(W3, false)]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.compromissoCumprido).toEqual({ base: 1, bonus: 0, total: 2, max: 10 });
  });

  it("agua pontua semanas com média >= 1500ml e soma 1 extra a partir de 2 semanas", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([dieta("2020-09-07", { agua_ml: 2000 }), dieta("2020-09-14", { agua_ml: 1800 })]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.agua).toEqual({ base: 2, bonus: 1, total: 3, max: 5 });
  });

  it("penalidade desconta 5 pontos da performance por dia com consumo de álcool", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([dieta("2020-09-07", { consumiu_alcool: true }), dieta("2020-09-08", { consumiu_alcool: true })]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.penalidade).toEqual({ total: 10, diasAlcool: 2 });
  });
});

describe("computeScoreAluno — desafios", () => {
  const desafioBase = { id: "desafio-1", organization_id: ORG_ID, titulo: "Desafio de setembro", descricao: null, criado_por: null, para_todos: true, created_at: "", updated_at: "" };

  it("conta pontos de um desafio concluído manualmente pela equipe", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "livre", meta_valor: null, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 15 }]);
    vi.spyOn(supabaseAdmin, "listDesafioProgressoForAluno").mockResolvedValue([{ id: "dp1", desafio_id: "desafio-1", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: true, valor_atual: null, concluido_por: "staff-1", concluido_em: "2020-09-20T00:00:00.000Z", created_at: "", updated_at: "" }]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.desafios).toEqual({ total: 15, max: 20 });
  });

  it("calcula sem_alcool automaticamente a partir da dieta registrada quando o desafio já encerrou", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-09-20T12:00:00.000Z"));
    try {
      mockVazio();
      vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "sem_alcool", meta_valor: 1, data_inicio: "2020-09-01", data_fim: "2020-09-15", pontos: 12 }]);
      vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockImplementation(async (_alunoId: string, desde: string, ate: string) => {
        if (desde === "2020-09-01" && ate === "2020-09-15") return [dieta("2020-09-05", { consumiu_alcool: false })];
        return [];
      });
      const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
      expect(result.performance.desafios).toEqual({ total: 12, max: 20 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("não fecha sem_alcool automaticamente enquanto o desafio não encerrou", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-09-10T12:00:00.000Z"));
    try {
      mockVazio();
      vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "sem_alcool", meta_valor: 1, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 30 }]);
      vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([dieta("2020-09-05", { consumiu_alcool: false })]);
      const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
      // "hoje" (2020-09-10) é anterior ao fim do desafio (2020-09-30): mesmo com o hábito
      // dentro da meta, sem_alcool nunca fecha automaticamente antes do desafio encerrar.
      expect(result.performance.desafios.total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignora um desafio do tipo 'livre' sem progresso manual (nunca calculado automaticamente)", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "livre", meta_valor: null, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 50 }]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.performance.desafios).toEqual({ total: 0, max: 20 });
  });

  it("só considera desafios para_todos ou em que o aluno participa", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, id: "desafio-2", para_todos: false, tipo: "livre", meta_valor: null, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 50 }]);
    vi.spyOn(supabaseAdmin, "listDesafioProgressoForAluno").mockResolvedValue([{ id: "dp1", desafio_id: "desafio-2", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: true, valor_atual: null, concluido_por: "staff-1", concluido_em: "2020-09-20T00:00:00.000Z", created_at: "", updated_at: "" }]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // Não é para_todos e o aluno não está na lista de participantes.
    expect(result.performance.desafios.total).toBe(0);
  });
});

describe("computeComparativoAluno", () => {
  it("nunca compara o aluno a um colega específico — só à média do grupo", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID, "aluno-2", "aluno-3"]);
    vi.spyOn(supabaseAdmin, "listCheckinsPeriodo").mockImplementation(async (userId: string) => (userId === ALUNO_ID ? [checkin("2020-09-07")] : []));
    const result = await computeComparativoAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // Sem progresso_semanal no período, os 3 alunos partem de metasMes=25 (nada
    // a penalizar); só o ALUNO_ID tem +1 de engajamento pelo check-in.
    expect(result).toEqual({ minhaPontuacao: 26, mediaGrupo: 76 / 3, tamanhoGrupo: 3 });
  });

  it("retorna um comparativo zerado (mas ainda mostra minha pontuação) quando a organização não tem nenhum aluno com Arke ativo", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([]);
    const result = await computeComparativoAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result).toEqual({ minhaPontuacao: 25, mediaGrupo: 0, tamanhoGrupo: 0 });
  });
});

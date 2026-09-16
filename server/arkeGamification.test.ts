import { afterEach, describe, expect, it, vi } from "vitest";
import { computeComparativoAluno, computeScoreAluno } from "./arkeGamification";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const ALUNO_ID = "aluno-1";
const ORG_ID = "org-1";
const DESDE = "2026-09-01";
const ATE = "2026-09-30";

function mockVazio() {
  vi.spyOn(supabaseAdmin, "listCheckinsPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listAvaliacoesSemanaisPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listCompromissoMetasConcluidasPeriodo").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listProgressoSemanal").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "getPlanoTreinoSemanal").mockResolvedValue(undefined as any);
  vi.spyOn(supabaseAdmin, "listDesafioProgressoForAluno").mockResolvedValue([]);
}

describe("computeScoreAluno", () => {
  it("returns zero for an aluno with no events in the period", async () => {
    mockVazio();
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result).toEqual({ eventos: [], total: 0 });
  });

  it("awards 5 points per real engagement event (checkin, avaliação, treino, dieta, micrometa)", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listCheckinsPeriodo").mockResolvedValue([{ id: "c1", user_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-05", dedicacao: "boa", horas_sono: null, created_at: "" }]);
    vi.spyOn(supabaseAdmin, "listAvaliacoesSemanaisPeriodo").mockResolvedValue([{ id: "a1", user_id: ALUNO_ID, organization_id: ORG_ID, semana: "2026-09-01", sono: 8, produtividade: 7, humor: 8, conquista: null, created_at: "", updated_at: "" }]);
    vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([{ id: "t1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-06", tipos: ["Musculação"], duracao_min: 60, distancia_km: null, intensidade: "moderada", detalhes: null, observacoes: null, created_at: "" }]);
    vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([{ id: "d1", aluno_id: ALUNO_ID, dieta_id: "dieta-1", organization_id: ORG_ID, data: "2026-09-06", adesao_percentual: 90, consumiu_doce: false, consumiu_alcool: false, agua_ml: 2000, observacoes: null, created_at: "" }]);
    vi.spyOn(supabaseAdmin, "listCompromissoMetasConcluidasPeriodo").mockResolvedValue([{ id: "m1", compromisso_id: "cp1", texto: "Treinar 4x", objetivo_vinculado: null, valor_vinculado: null, concluida: true, created_at: "", compromisso_semanal: { semana: "2026-09-01" } }]);

    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);

    expect(result.total).toBe(25);
    expect(result.eventos).toHaveLength(5);
    expect(result.eventos.every((evento) => evento.origem === "engajamento" && evento.pontos === 5)).toBe(true);
  });

  it("awards a meta de peso bonus only when within the tolerance of meta_peso_kg", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listProgressoSemanal").mockResolvedValue([
      { id: "p1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-15", peso_kg: 79, gordura_percentual: null, musculo_percentual: null, cintura_cm: null, quadril_cm: null, braco_cm: null, perna_cm: null, bem_estar: null, observacoes: null, meta_peso_kg: 80, created_at: "" },
    ]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.eventos).toEqual([{ origem: "meta", descricao: "Meta de peso atingida (79kg, meta 80kg)", pontos: 20, data: "2026-09-15" }]);
    expect(result.total).toBe(20);
  });

  it("does not award the meta de peso bonus when outside the tolerance", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listProgressoSemanal").mockResolvedValue([
      { id: "p1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-15", peso_kg: 75, gordura_percentual: null, musculo_percentual: null, cintura_cm: null, quadril_cm: null, braco_cm: null, perna_cm: null, bem_estar: null, observacoes: null, meta_peso_kg: 80, created_at: "" },
    ]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result.total).toBe(0);
  });

  it("awards the weekly training goal bonus once per week where distinct training days meet the plan", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "getPlanoTreinoSemanal").mockResolvedValue({ id: "pl1", user_id: ALUNO_ID, organization_id: ORG_ID, dias_treino: ["segunda", "quarta", "sexta"], horario_preferido: null, local_treino: null, created_at: "", updated_at: "" });
    // Semana de 2026-09-07 (segunda) a 2026-09-13 (domingo).
    vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([
      { id: "t1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-07", tipos: ["Musculação"], duracao_min: 60, distancia_km: null, intensidade: "moderada", detalhes: null, observacoes: null, created_at: "" },
      { id: "t2", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-09", tipos: ["Corrida"], duracao_min: 40, distancia_km: 5, intensidade: "alta", detalhes: null, observacoes: null, created_at: "" },
      { id: "t3", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-11", tipos: ["Musculação"], duracao_min: 60, distancia_km: null, intensidade: "moderada", detalhes: null, observacoes: null, created_at: "" },
    ]);
    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    // Cada treino também soma 5 pontos de engajamento (registro em si) — a
    // meta semanal é um bônus além disso, não em vez disso.
    expect(result.eventos).toContainEqual({ origem: "meta", descricao: "Meta semanal de treinos atingida (3/3)", pontos: 15, data: "2026-09-07" });
    expect(result.eventos.filter((evento) => evento.origem === "engajamento")).toHaveLength(3);
    expect(result.total).toBe(15 + 3 * 5);
  });

  it("counts a desafio's points only when concluido_em falls within the requested period", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listDesafioProgressoForAluno").mockResolvedValue([
      { id: "dp1", desafio_id: "desafio-1", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: true, valor_atual: 10, concluido_por: "staff-1", concluido_em: "2026-09-20T12:00:00.000Z", created_at: "", updated_at: "" },
      { id: "dp2", desafio_id: "desafio-2", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: true, valor_atual: 10, concluido_por: "staff-1", concluido_em: "2026-08-01T12:00:00.000Z", created_at: "", updated_at: "" },
      { id: "dp3", desafio_id: "desafio-3", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: false, valor_atual: 3, concluido_por: null, concluido_em: null, created_at: "", updated_at: "" },
    ]);
    vi.spyOn(supabaseAdmin, "getDesafio").mockImplementation(async (id: string) => ({ id, organization_id: ORG_ID, titulo: id === "desafio-1" ? "Desafio de setembro" : "Outro", descricao: null, tipo: "livre", meta_valor: null, data_inicio: "2026-09-01", data_fim: "2026-09-30", pontos: 50, criado_por: null, para_todos: true, created_at: "", updated_at: "" }));

    const result = await computeScoreAluno(ALUNO_ID, ORG_ID, DESDE, ATE);

    expect(result.eventos).toEqual([{ origem: "desafio", descricao: "Desafio concluído: Desafio de setembro", pontos: 50, data: "2026-09-20" }]);
    expect(result.total).toBe(50);
  });
});

describe("computeComparativoAluno", () => {
  it("never compares the aluno to a single peer — only to the group average", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID, "aluno-2", "aluno-3"]);
    const scoreSpy = vi.spyOn(supabaseAdmin, "listCheckinsPeriodo");
    scoreSpy.mockImplementation(async (userId: string) => (userId === ALUNO_ID ? [{ id: "c1", user_id: ALUNO_ID, organization_id: ORG_ID, data: "2026-09-05", dedicacao: "boa", horas_sono: null, created_at: "" }] : []));

    const result = await computeComparativoAluno(ALUNO_ID, ORG_ID, DESDE, ATE);

    expect(result).toEqual({ minhaPontuacao: 5, mediaGrupo: 5 / 3, tamanhoGrupo: 3 });
  });

  it("returns a zeroed comparativo when the organization has no aluno with Arke ativo", async () => {
    mockVazio();
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([]);
    const result = await computeComparativoAluno(ALUNO_ID, ORG_ID, DESDE, ATE);
    expect(result).toEqual({ minhaPontuacao: 0, mediaGrupo: 0, tamanhoGrupo: 0 });
  });
});

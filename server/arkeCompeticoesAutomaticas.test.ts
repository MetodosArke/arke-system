import { afterEach, describe, expect, it, vi } from "vitest";
import { runArkeCompeticoesAutomaticas } from "./arkeCompeticoesAutomaticas";
import * as arkeGamification from "./arkeGamification";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const ORG_ID = "org-1";
const ALUNO_ID = "aluno-1";
const baseModule = { organization_id: ORG_ID, enabled: true, package_tier: "starter" as const, amount_cents: 9900, enabled_at: "2026-01-01", last_repasse_charged_at: null, updated_at: "2026-01-01" };
const competicaoBase = { id: "competicao-1", organization_id: ORG_ID, titulo: "Setembro Ativo", descricao: null, data_inicio: "2020-09-01", data_fim: "2020-09-30", metrica: "Pontuação geral", status: "ativa", para_todos: true, criado_por: null, created_at: "", updated_at: "" };

describe("runArkeCompeticoesAutomaticas", () => {
  it("não processa nada quando nenhuma organização tem o módulo Arke habilitado", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([]);
    const setSpy = vi.spyOn(supabaseAdmin, "setCompeticaoPontuacao");

    const result = await runArkeCompeticoesAutomaticas();

    expect(setSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ competicoesProcessadas: 0, pontuacoesAtualizadas: 0, falhas: 0 });
  });

  it("ignora competições com modo_pontuacao='manual' (padrão)", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
    vi.spyOn(supabaseAdmin, "listCompeticoes").mockResolvedValue([{ ...competicaoBase, modo_pontuacao: "manual" }]);
    const setSpy = vi.spyOn(supabaseAdmin, "setCompeticaoPontuacao");

    const result = await runArkeCompeticoesAutomaticas();

    expect(setSpy).not.toHaveBeenCalled();
    expect(result.competicoesProcessadas).toBe(0);
  });

  it("calcula e grava a pontuação automática a partir do motor de pontuação (computeScoreAluno)", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
    vi.spyOn(supabaseAdmin, "listCompeticoes").mockResolvedValue([{ ...competicaoBase, modo_pontuacao: "automatica" }]);
    vi.spyOn(supabaseAdmin, "listCompeticaoPontuacaoForCompeticao").mockResolvedValue([]);
    const scoreSpy = vi.spyOn(arkeGamification, "computeScoreAluno").mockResolvedValue({ total: 42 } as any);
    const setSpy = vi.spyOn(supabaseAdmin, "setCompeticaoPontuacao").mockResolvedValue({} as any);

    const result = await runArkeCompeticoesAutomaticas();

    expect(scoreSpy).toHaveBeenCalledWith(ALUNO_ID, ORG_ID, "2020-09-01", "2020-09-30");
    expect(setSpy).toHaveBeenCalledWith({ competicaoId: "competicao-1", alunoId: ALUNO_ID, organizationId: ORG_ID, valor: 42, origem: "automatico" });
    expect(result).toEqual({ competicoesProcessadas: 1, pontuacoesAtualizadas: 1, falhas: 0 });
  });

  it("nunca sobrescreve uma pontuação que a equipe já ajustou manualmente", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
    vi.spyOn(supabaseAdmin, "listCompeticoes").mockResolvedValue([{ ...competicaoBase, modo_pontuacao: "automatica" }]);
    vi.spyOn(supabaseAdmin, "listCompeticaoPontuacaoForCompeticao").mockResolvedValue([
      { id: "cp1", competicao_id: "competicao-1", aluno_id: ALUNO_ID, organization_id: ORG_ID, valor: 99, origem: "manual", atualizado_por: "staff-1", created_at: "", updated_at: "" },
    ]);
    const scoreSpy = vi.spyOn(arkeGamification, "computeScoreAluno");
    const setSpy = vi.spyOn(supabaseAdmin, "setCompeticaoPontuacao");

    const result = await runArkeCompeticoesAutomaticas();

    expect(scoreSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ competicoesProcessadas: 1, pontuacoesAtualizadas: 0, falhas: 0 });
  });

  it("restringe aos participantes selecionados quando para_todos=false", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID, "aluno-2"]);
    vi.spyOn(supabaseAdmin, "listCompeticoes").mockResolvedValue([{ ...competicaoBase, para_todos: false, modo_pontuacao: "automatica" }]);
    vi.spyOn(supabaseAdmin, "listCompeticaoParticipantes").mockResolvedValue([{ id: "part1", competicao_id: "competicao-1", aluno_id: ALUNO_ID, organization_id: ORG_ID, created_at: "" }]);
    vi.spyOn(supabaseAdmin, "listCompeticaoPontuacaoForCompeticao").mockResolvedValue([]);
    vi.spyOn(arkeGamification, "computeScoreAluno").mockResolvedValue({ total: 10 } as any);
    const setSpy = vi.spyOn(supabaseAdmin, "setCompeticaoPontuacao").mockResolvedValue({} as any);

    await runArkeCompeticoesAutomaticas();

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ alunoId: ALUNO_ID }));
  });

  it("conta uma falha sem interromper o restante quando o cálculo de um aluno estoura", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
    vi.spyOn(supabaseAdmin, "listCompeticoes").mockResolvedValue([{ ...competicaoBase, modo_pontuacao: "automatica" }]);
    vi.spyOn(supabaseAdmin, "listCompeticaoPontuacaoForCompeticao").mockResolvedValue([]);
    vi.spyOn(arkeGamification, "computeScoreAluno").mockRejectedValue(new Error("Supabase indisponível"));

    const result = await runArkeCompeticoesAutomaticas();

    expect(result.falhas).toBe(1);
  });
});

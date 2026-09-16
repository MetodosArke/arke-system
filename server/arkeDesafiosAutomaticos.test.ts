import { afterEach, describe, expect, it, vi } from "vitest";
import { runArkeDesafiosAutomaticos } from "./arkeDesafiosAutomaticos";
import * as db from "./db";
import * as push from "./push";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const ORG_ID = "org-1";
const ALUNO_ID = "aluno-1";
const baseModule = { organization_id: ORG_ID, enabled: true, package_tier: "starter" as const, amount_cents: 9900, enabled_at: "2026-01-01", last_repasse_charged_at: null, updated_at: "2026-01-01" };
const desafioBase = { id: "desafio-1", organization_id: ORG_ID, titulo: "Sem álcool em setembro", descricao: null, criado_por: null, para_todos: true, created_at: "", updated_at: "" };

function mockOrgVazia() {
  vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
  vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([]);
  vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
}

describe("runArkeDesafiosAutomaticos", () => {
  it("não processa nada quando nenhuma organização tem o módulo Arke habilitado", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([]);
    const setSpy = vi.spyOn(supabaseAdmin, "setDesafioProgresso");

    const result = await runArkeDesafiosAutomaticos();

    expect(setSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ desafiosProcessados: 0, progressosAtualizados: 0, concluidosAgora: 0, falhas: 0 });
  });

  it("ignora desafios do tipo 'livre' (nunca automático)", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "livre", meta_valor: null, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 10 }]);
    const setSpy = vi.spyOn(supabaseAdmin, "setDesafioProgresso");

    const result = await runArkeDesafiosAutomaticos();

    expect(setSpy).not.toHaveBeenCalled();
    expect(result.desafiosProcessados).toBe(0);
  });

  it("marca concluído e notifica a equipe quando um desafio numero_treinos bate a meta pela primeira vez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-09-10T12:00:00.000Z"));
    try {
      vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
      vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([ALUNO_ID]);
      vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "numero_treinos", meta_valor: 2, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 15 }]);
      vi.spyOn(supabaseAdmin, "listDesafioProgressoForDesafio").mockResolvedValue([]);
      vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockResolvedValue([
        { id: "t1", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2020-09-02", tipos: ["corrida"], duracao_min: 40, distancia_km: null, intensidade: null, detalhes: null, observacoes: null, created_at: "" },
        { id: "t2", aluno_id: ALUNO_ID, organization_id: ORG_ID, data: "2020-09-04", tipos: ["corrida"], duracao_min: 40, distancia_km: null, intensidade: null, detalhes: null, observacoes: null, created_at: "" },
      ]);
      const setSpy = vi.spyOn(supabaseAdmin, "setDesafioProgresso").mockResolvedValue({} as any);
      vi.spyOn(supabaseAdmin, "listStudentsInOrganization").mockResolvedValue([{ user_id: ALUNO_ID, full_name: "Aluno Teste", organization_id: ORG_ID, status: "active", unit_id: null, matricula_em: null }]);
      vi.spyOn(db, "listActiveStaffUserIds").mockResolvedValue(["staff-1"]);
      const notifySpy = vi.spyOn(supabaseAdmin, "createNotificacao").mockResolvedValue({} as any);
      vi.spyOn(push, "sendPushToUser").mockResolvedValue({ sent: 0 } as any);

      const result = await runArkeDesafiosAutomaticos();

      expect(setSpy).toHaveBeenCalledWith({ desafioId: "desafio-1", alunoId: ALUNO_ID, organizationId: ORG_ID, concluido: true, valorAtual: 2, origem: "automatico" });
      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff-1", tipo: "desafio" }));
      expect(result).toEqual({ desafiosProcessados: 1, progressosAtualizados: 1, concluidosAgora: 1, falhas: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("nunca sobrescreve uma linha que a equipe já marcou manualmente", async () => {
    mockOrgVazia();
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "numero_treinos", meta_valor: 2, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 15 }]);
    vi.spyOn(supabaseAdmin, "listDesafioProgressoForDesafio").mockResolvedValue([
      { id: "dp1", desafio_id: "desafio-1", aluno_id: ALUNO_ID, organization_id: ORG_ID, concluido: false, valor_atual: 0, concluido_por: null, concluido_em: null, origem: "manual", created_at: "", updated_at: "" },
    ]);
    const setSpy = vi.spyOn(supabaseAdmin, "setDesafioProgresso");
    const treinoSpy = vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo");

    const result = await runArkeDesafiosAutomaticos();

    expect(setSpy).not.toHaveBeenCalled();
    expect(treinoSpy).not.toHaveBeenCalled(); // nem chega a calcular — o aluno já está travado em 'manual'
    expect(result).toEqual({ desafiosProcessados: 1, progressosAtualizados: 0, concluidosAgora: 0, falhas: 0 });
  });

  it("não fecha sem_alcool automaticamente enquanto o desafio não encerrou (mesma regra do motor de pontuação)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-09-10T12:00:00.000Z"));
    try {
      mockOrgVazia();
      vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "sem_alcool", meta_valor: 1, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 30 }]);
      vi.spyOn(supabaseAdmin, "listDesafioProgressoForDesafio").mockResolvedValue([]);
      vi.spyOn(supabaseAdmin, "listDietaAdesaoPeriodo").mockResolvedValue([{ id: "d1", aluno_id: ALUNO_ID, dieta_id: "dieta-1", organization_id: ORG_ID, data: "2020-09-05", adesao_percentual: 90, consumiu_doce: false, consumiu_alcool: false, agua_ml: 2000, observacoes: null, created_at: "2020-09-05T10:00:00.000Z" }]);
      const setSpy = vi.spyOn(supabaseAdmin, "setDesafioProgresso").mockResolvedValue({} as any);

      const result = await runArkeDesafiosAutomaticos();

      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ concluido: false, origem: "automatico" }));
      expect(result.concluidosAgora).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("conta uma falha sem interromper o restante quando o cálculo de um aluno estoura", async () => {
    mockOrgVazia();
    vi.spyOn(supabaseAdmin, "listDesafios").mockResolvedValue([{ ...desafioBase, tipo: "numero_treinos", meta_valor: 1, data_inicio: "2020-09-01", data_fim: "2020-09-30", pontos: 10 }]);
    vi.spyOn(supabaseAdmin, "listDesafioProgressoForDesafio").mockResolvedValue([]);
    vi.spyOn(supabaseAdmin, "listTreinoCalendarioPeriodo").mockRejectedValue(new Error("Supabase indisponível"));

    const result = await runArkeDesafiosAutomaticos();

    expect(result.falhas).toBe(1);
  });
});

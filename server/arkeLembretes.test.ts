import { afterEach, describe, expect, it, vi } from "vitest";
import { runArkeLembretesDiarios } from "./arkeLembretes";
import * as push from "./push";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const baseModule = { organization_id: "org-1", enabled: true, package_tier: "starter" as const, amount_cents: 9900, enabled_at: "2026-01-01", last_repasse_charged_at: null, updated_at: "2026-01-01" };

// Segunda-feira (2026-09-14) — só o lembrete de início de semana e o de
// check-in devem estar em jogo; domingo (progresso semanal) fica fora do
// dia da semana testado aqui.
const SEGUNDA_FEIRA = new Date("2026-09-14T12:00:00.000Z");

describe("runArkeLembretesDiarios", () => {
  it("skips organizations without any aluno with Arke ativo", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue([]);
    const createSpy = vi.spyOn(supabaseAdmin, "createNotificacao");

    const result = await runArkeLembretesDiarios();

    expect(createSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ alunosProcessados: 0, lembretesEnviados: 0, falhas: 0 });
  });

  it("does not remind an aluno who checked in recently and it isn't Monday or Sunday", async () => {
    vi.useFakeTimers().setSystemTime(SEGUNDA_FEIRA);
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue(["aluno-1"]);
    vi.spyOn(supabaseAdmin, "hasCheckinDesde").mockResolvedValue(true);
    vi.spyOn(supabaseAdmin, "hasProgressoSemanalDesde").mockResolvedValue(true);
    const createSpy = vi.spyOn(supabaseAdmin, "createNotificacao").mockResolvedValue(undefined as any);

    const result = await runArkeLembretesDiarios();

    // Segunda-feira sempre dispara o lembrete motivacional de início de semana.
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: "aluno-1", tipo: "lembrete" }));
    expect(result).toEqual({ alunosProcessados: 1, lembretesEnviados: 1, falhas: 0 });
    vi.useRealTimers();
  });

  it("sends a stronger reminder after 7 days without check-in instead of the 3-day one", async () => {
    vi.useFakeTimers().setSystemTime(SEGUNDA_FEIRA);
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue(["aluno-1"]);
    vi.spyOn(supabaseAdmin, "hasCheckinDesde").mockResolvedValue(false);
    vi.spyOn(supabaseAdmin, "hasProgressoSemanalDesde").mockResolvedValue(true);
    const createSpy = vi.spyOn(supabaseAdmin, "createNotificacao").mockResolvedValue(undefined as any);

    const result = await runArkeLembretesDiarios();

    const titulos = createSpy.mock.calls.map((call) => call[0].titulo);
    expect(titulos).toContain("⚠️ Revisão de rotina");
    expect(titulos).not.toContain("💪 Bora treinar!");
    expect(result.lembretesEnviados).toBe(2); // início de semana + revisão de rotina
    vi.useRealTimers();
  });

  it("counts a failure without throwing when notifying an aluno errors out", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([baseModule]);
    vi.spyOn(supabaseAdmin, "listAlunosComArkeAtivoIds").mockResolvedValue(["aluno-1"]);
    vi.spyOn(supabaseAdmin, "hasCheckinDesde").mockRejectedValue(new Error("Supabase indisponível"));
    vi.spyOn(push, "sendPushToUser").mockResolvedValue({ sent: 0 });

    const result = await runArkeLembretesDiarios();

    expect(result.falhas).toBe(1);
  });
});

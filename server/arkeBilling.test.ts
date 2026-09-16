import { afterEach, describe, expect, it, vi } from "vitest";
import { runArkeRepasseMensal } from "./arkeBilling";
import * as asaas from "./asaas";
import * as asaasPersistence from "./asaasPersistence";
import * as db from "./db";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

const baseModule = { organization_id: "org-1", enabled: true, package_tier: "starter" as const, amount_cents: 9900, enabled_at: "2026-01-01", updated_at: "2026-01-01" };

describe("runArkeRepasseMensal", () => {
  it("skips an organization already charged this month", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([{ ...baseModule, last_repasse_charged_at: new Date().toISOString().slice(0, 10) }]);
    const countSpy = vi.spyOn(supabaseAdmin, "countAlunosComArkeAtivo");
    const result = await runArkeRepasseMensal();
    expect(countSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ organizacoesCobradas: 0, organizacoesSemAlunoAtivo: 0, falhas: 0 });
  });

  it("skips an organization with no active aluno (never charges for zero students)", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([{ ...baseModule, last_repasse_charged_at: null }]);
    vi.spyOn(supabaseAdmin, "countAlunosComArkeAtivo").mockResolvedValue(0);
    const paymentSpy = vi.spyOn(asaas, "createAsaasPayment");
    const result = await runArkeRepasseMensal();
    expect(paymentSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ organizacoesCobradas: 0, organizacoesSemAlunoAtivo: 1, falhas: 0 });
  });

  it("charges the wholesale value per active aluno and marks the organization as charged", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([{ ...baseModule, last_repasse_charged_at: null }]);
    vi.spyOn(supabaseAdmin, "countAlunosComArkeAtivo").mockResolvedValue(3);
    vi.spyOn(db, "getOrCreateAsaasCustomerForOrganization").mockResolvedValue("cus_123");
    const paymentSpy = vi.spyOn(asaas, "createAsaasPayment").mockResolvedValue({ id: "pay_1", value: 179.7 } as any);
    vi.spyOn(asaasPersistence, "upsertAsaasPayment").mockResolvedValue(undefined);
    const markSpy = vi.spyOn(supabaseAdmin, "markArkeRepasseCharged").mockResolvedValue(undefined);

    const result = await runArkeRepasseMensal();

    expect(paymentSpy).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_123", value: 179.7, description: expect.stringContaining("3 aluno(s)") }));
    expect(markSpy).toHaveBeenCalledWith("org-1", expect.any(String));
    expect(result).toEqual({ organizacoesCobradas: 1, organizacoesSemAlunoAtivo: 0, falhas: 0 });
  });

  it("counts a failure without throwing when the Asaas call errors out", async () => {
    vi.spyOn(supabaseAdmin, "listArkeModulesEnabled").mockResolvedValue([{ ...baseModule, last_repasse_charged_at: null }]);
    vi.spyOn(supabaseAdmin, "countAlunosComArkeAtivo").mockResolvedValue(2);
    vi.spyOn(db, "getOrCreateAsaasCustomerForOrganization").mockRejectedValue(new Error("Asaas indisponível"));

    const result = await runArkeRepasseMensal();

    expect(result).toEqual({ organizacoesCobradas: 0, organizacoesSemAlunoAtivo: 0, falhas: 1 });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { alunoTemArke, assertAlunoTemArke } from "./arkeEntitlement";
import * as supabaseAdmin from "./supabaseAdmin";

afterEach(() => vi.restoreAllMocks());

describe("alunoTemArke", () => {
  it("returns false when the aluno has no organization", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: null, status: "active", unit_id: null, matricula_em: null });
    expect(await alunoTemArke("aluno-1")).toBe(false);
  });

  it("returns false when there is no licença row for the org", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    vi.spyOn(supabaseAdmin, "getAlunoArkeLicenca").mockResolvedValue(null);
    expect(await alunoTemArke("aluno-1")).toBe(false);
  });

  it("returns false when the licença exists but is inactive", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    vi.spyOn(supabaseAdmin, "getAlunoArkeLicenca").mockResolvedValue({ id: "l1", organization_id: "org-1", user_id: "aluno-1", ativo: false, ativado_em: null, desativado_em: null, ativado_por: null, created_at: "", updated_at: "" });
    expect(await alunoTemArke("aluno-1")).toBe(false);
  });

  it("returns true when the licença is active", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    vi.spyOn(supabaseAdmin, "getAlunoArkeLicenca").mockResolvedValue({ id: "l1", organization_id: "org-1", user_id: "aluno-1", ativo: true, ativado_em: "2026-01-01", desativado_em: null, ativado_por: "staff-1", created_at: "", updated_at: "" });
    expect(await alunoTemArke("aluno-1")).toBe(true);
  });
});

describe("assertAlunoTemArke", () => {
  it("throws a friendly error when the aluno does not have Arke", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    vi.spyOn(supabaseAdmin, "getAlunoArkeLicenca").mockResolvedValue(null);
    await expect(assertAlunoTemArke("aluno-1")).rejects.toThrow(/método Arke/);
  });

  it("resolves silently when the aluno has Arke active", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    vi.spyOn(supabaseAdmin, "getAlunoArkeLicenca").mockResolvedValue({ id: "l1", organization_id: "org-1", user_id: "aluno-1", ativo: true, ativado_em: "2026-01-01", desativado_em: null, ativado_por: "staff-1", created_at: "", updated_at: "" });
    await expect(assertAlunoTemArke("aluno-1")).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { ARKE_ALUNO_WHOLESALE_CENTS, ARKE_MODULE_PACKAGE_AMOUNTS_CENTS, ORG_PLAN_AMOUNTS_CENTS, PLAN_AMOUNTS_CENTS, PLAN_LIMITS, PROFISSIONAL_PLAN_AMOUNTS_CENTS, SAAS_PLAN_KEYS, SETUP_FEE_CENTS, formatBRL } from "@shared/pricing";

describe("pricing", () => {
  it("has limits and amounts defined for every plan key", () => {
    for (const plan of SAAS_PLAN_KEYS) {
      expect(PLAN_LIMITS[plan]).toBeDefined();
      expect(PLAN_AMOUNTS_CENTS[plan]).toBeGreaterThan(0);
    }
  });

  it("matches the commercial rules for org plans (Starter 299 / Growth 699 / Scale 1490)", () => {
    expect(ORG_PLAN_AMOUNTS_CENTS.starter).toBe(29900);
    expect(ORG_PLAN_AMOUNTS_CENTS.growth).toBe(69900);
    expect(ORG_PLAN_AMOUNTS_CENTS.scale).toBe(149000);
  });

  it("matches the commercial rules for professional plans (Essencial 79 / Performance 149 / Ilimitado 249)", () => {
    expect(PROFISSIONAL_PLAN_AMOUNTS_CENTS.essencial).toBe(7900);
    expect(PROFISSIONAL_PLAN_AMOUNTS_CENTS.performance).toBe(14900);
    expect(PROFISSIONAL_PLAN_AMOUNTS_CENTS.ilimitado).toBe(24900);
  });

  it("matches the Módulo Arke package tiers (99/249/499) and the per-aluno wholesale price", () => {
    expect(ARKE_MODULE_PACKAGE_AMOUNTS_CENTS.starter).toBe(9900);
    expect(ARKE_MODULE_PACKAGE_AMOUNTS_CENTS.growth).toBe(24900);
    expect(ARKE_MODULE_PACKAGE_AMOUNTS_CENTS.scale).toBe(49900);
    expect(ARKE_ALUNO_WHOLESALE_CENTS).toBe(5990);
  });

  it("matches the setup fee (R$1.490 one-time)", () => {
    expect(SETUP_FEE_CENTS).toBe(149000);
  });

  it("formats cents as BRL currency", () => {
    expect(formatBRL(29900)).toMatch(/R\$\s*299,00/);
  });
});

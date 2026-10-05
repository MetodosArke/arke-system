import { describe, it, expect } from "vitest";
import { comVariacao } from "../src/core/espera";

describe("espera com variação", () => {
  it("fica entre a metade e o total", () => {
    expect(comVariacao(10_000, () => 0)).toBe(5_000);
    expect(comVariacao(10_000, (max) => max)).toBe(10_000);
    expect(comVariacao(10_001, () => 0)).toBe(5_001);
    // Sorteio fora da faixa não passa do total nem desce da metade.
    expect(comVariacao(10_000, () => 99_999)).toBe(10_000);
    expect(comVariacao(10_000, () => -5)).toBe(5_000);
  });

  it("com o sorteio de verdade, espalha os Gateways", () => {
    const esperas = Array.from({ length: 500 }, () => comVariacao(60_000));
    expect(Math.min(...esperas)).toBeGreaterThanOrEqual(30_000);
    expect(Math.max(...esperas)).toBeLessThanOrEqual(60_000);
    // 500 Gateways caindo juntos não voltam no mesmo instante.
    expect(new Set(esperas).size).toBeGreaterThan(400);
  });

  it("espera mínima passa como veio", () => {
    expect(comVariacao(0)).toBe(0);
    expect(comVariacao(1)).toBe(1);
  });
});

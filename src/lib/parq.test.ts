import { describe, expect, it } from "vitest";
import { modeloContratoMatricula, PERGUNTAS_PARQ, situacaoAtestado } from "./parq";

const HOJE = new Date("2026-09-22T12:00:00Z");

describe("situacaoAtestado", () => {
  it("sem PAR-Q ou sem nenhum sim, não precisa", () => {
    expect(situacaoAtestado(null, HOJE)).toBe("nao_precisa");
    expect(situacaoAtestado({ algum_sim: false, atestado_validade: null }, HOJE)).toBe("nao_precisa");
  });
  it("sim sem atestado, falta", () => {
    expect(situacaoAtestado({ algum_sim: true, atestado_validade: null }, HOJE)).toBe("falta");
  });
  it("vencido, vence em breve (15 dias) e válido", () => {
    expect(situacaoAtestado({ algum_sim: true, atestado_validade: "2026-09-21" }, HOJE)).toBe("vencido");
    expect(situacaoAtestado({ algum_sim: true, atestado_validade: "2026-09-22" }, HOJE)).toBe("vence_logo");
    expect(situacaoAtestado({ algum_sim: true, atestado_validade: "2026-10-06" }, HOJE)).toBe("vence_logo");
    expect(situacaoAtestado({ algum_sim: true, atestado_validade: "2026-10-07" }, HOJE)).toBe("valido");
  });
});

describe("PAR-Q e contrato modelo", () => {
  it("tem as 7 perguntas do PAR-Q+", () => {
    expect(PERGUNTAS_PARQ).toHaveLength(7);
  });
  it("contrato modelo leva o nome da academia e passa do mínimo do banco", () => {
    const texto = modeloContratoMatricula("Academia X");
    expect(texto).toContain("Academia X");
    expect(texto.length).toBeGreaterThan(50);
  });
});

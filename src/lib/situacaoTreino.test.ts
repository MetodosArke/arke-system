import { describe, expect, it } from "vitest";
import { situacaoDoTreino } from "./situacaoTreino";

describe("situacaoDoTreino", () => {
  const hoje = "2026-11-10";

  it("sem treino ativo é sem treino", () => {
    expect(situacaoDoTreino(undefined, hoje)).toBe("sem_treino");
  });

  it("validade antes de hoje é vencido; hoje ainda vale", () => {
    expect(situacaoDoTreino({ validade_fim: "2026-11-09" }, hoje)).toBe("vencido");
    expect(situacaoDoTreino({ validade_fim: "2026-11-10" }, hoje)).toBe("em_dia");
  });

  it("sem validade é em dia", () => {
    expect(situacaoDoTreino({ validade_fim: null }, hoje)).toBe("em_dia");
  });
});

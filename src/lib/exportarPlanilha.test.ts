import { describe, expect, it } from "vitest";
import { dataBr, intervaloDoMes } from "./exportarPlanilha";

describe("exportarPlanilha", () => {
  it("intervalo do mês respeita o último dia de cada mês", () => {
    expect(intervaloDoMes("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(intervaloDoMes("2028-02")).toEqual({ inicio: "2028-02-01", fim: "2028-02-29" });
    expect(intervaloDoMes("2026-09")).toEqual({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(intervaloDoMes("2026-12")).toEqual({ inicio: "2026-12-01", fim: "2026-12-31" });
  });

  it("data brasileira sem deslocar o dia pelo fuso", () => {
    expect(dataBr("2026-09-01")).toBe("01/09/2026");
    expect(dataBr("2026-09-01T02:00:00Z")).toBe("01/09/2026");
    expect(dataBr(null)).toBe("");
  });
});

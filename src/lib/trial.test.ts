import { describe, it, expect, vi, afterEach } from "vitest";
import { descreverPrazoTrial } from "./trial";

const fixarHoje = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  vi.useRealTimers();
});

describe("descreverPrazoTrial", () => {
  it("conta os dias que faltam", () => {
    fixarHoje("2026-09-20T12:00:00Z");
    expect(descreverPrazoTrial("2026-10-05")).toBe("faltam 15 dias");
  });

  it("usa singular quando falta um dia só", () => {
    fixarHoje("2026-09-20T12:00:00Z");
    expect(descreverPrazoTrial("2026-09-21")).toBe("falta 1 dia");
  });

  it("marca o vencimento no próprio dia", () => {
    fixarHoje("2026-09-20T12:00:00Z");
    expect(descreverPrazoTrial("2026-09-20")).toBe("vence hoje");
  });

  it("marca trial já vencido", () => {
    fixarHoje("2026-09-20T12:00:00Z");
    expect(descreverPrazoTrial("2026-09-18")).toBe("vencido há 2 dias");
  });

  it("ignora a parte de hora se vier um timestamp em vez de date", () => {
    // trial_vencimento é `date` no Postgres, mas a RPC do funil e a view de
    // tenants passam por casts; aceitar os dois formatos evita NaN na conta.
    fixarHoje("2026-09-20T12:00:00Z");
    expect(descreverPrazoTrial("2026-10-05T00:00:00.000Z")).toBe("faltam 15 dias");
  });
});

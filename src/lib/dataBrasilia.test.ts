import { describe, it, expect } from "vitest";
import { dataBrasilia, hojeBrasilia, diaBrasilia } from "./dataBrasilia";

describe("data de Brasília", () => {
  it("devolve o dia de Brasília, não o de UTC, na janela da noite", () => {
    // 23:25 de 22/09 em Brasília é 02:25 de 23/09 em UTC. É a janela em que
    // o defeito aparecia: o app dizia 23 enquanto o banco (e o aluno) diziam 22.
    const noite = new Date("2026-09-23T02:25:00Z");
    expect(noite.toISOString().slice(0, 10)).toBe("2026-09-23"); // o jeito errado
    expect(dataBrasilia(noite)).toBe("2026-09-22");
  });

  it("concorda com UTC fora da janela", () => {
    expect(dataBrasilia(new Date("2026-09-22T15:00:00Z"))).toBe("2026-09-22");
  });

  it("vira o dia às 00:00 de Brasília, não às 00:00 de UTC", () => {
    expect(dataBrasilia(new Date("2026-09-23T02:59:59Z"))).toBe("2026-09-22");
    expect(dataBrasilia(new Date("2026-09-23T03:00:00Z"))).toBe("2026-09-23");
  });

  it("formata como as colunas date do Postgres", () => {
    expect(dataBrasilia(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });

  it("anda para trás e para frente sem escorregar de dia", () => {
    const base = new Date("2026-09-22T15:00:00Z");
    expect(diaBrasilia(-1, base)).toBe("2026-09-21");
    expect(diaBrasilia(-30, base)).toBe("2026-08-23");
    expect(diaBrasilia(15, base)).toBe("2026-10-07");
  });

  it("atravessa a virada do mês e do ano", () => {
    expect(diaBrasilia(1, new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    // 31/01 + 1 dia não pode virar 31/02 nem pular fevereiro.
    expect(diaBrasilia(1, new Date("2026-01-31T15:00:00Z"))).toBe("2026-02-01");
  });

  it("hojeBrasilia é a data de Brasília do instante atual", () => {
    expect(hojeBrasilia()).toBe(dataBrasilia(new Date()));
    expect(hojeBrasilia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("não depende do fuso de quem está olhando", () => {
    // O mesmo instante, lido por um aparelho em qualquer fuso, dá a data da
    // academia: é isso que mantém a tela de acordo com o banco.
    const instante = new Date("2026-09-23T02:25:00Z");
    expect(dataBrasilia(instante)).toBe("2026-09-22");
  });
});

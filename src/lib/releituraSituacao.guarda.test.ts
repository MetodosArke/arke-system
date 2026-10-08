import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deveReler, RELEITURA_ESPERA_MINIMA_MS, RELEITURA_INTERVALO_MS, vigiarSituacao } from "./releituraSituacao";

/**
 * A situação do aluno (em dia, pausado, inadimplente) era lida só na entrada
 * do app: a academia pausava o aluno e ele seguia usando até sair e entrar de
 * novo (auditoria de prontidão, 07/10/2026). Agora o app relê ao voltar para a
 * tela e de 15 em 15 minutos, sem consultar a cada tela. O comportamento no
 * AuthContext está em `AuthContext.acesso.test.tsx` ("a situação relida").
 */

function documentoFalso() {
  const ouvintes = new Set<() => void>();
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => ouvintes.add(fn),
    removeEventListener: (_: string, fn: () => void) => ouvintes.delete(fn),
    mudar(estado: DocumentVisibilityState) {
      this.visibilityState = estado;
      for (const fn of ouvintes) fn();
    },
    ouvintes,
  };
}

let agora = 0;
beforeEach(() => {
  vi.useFakeTimers();
  agora = 1_000_000;
});
afterEach(() => vi.useRealTimers());

describe("a releitura da situação do aluno", () => {
  it("ao voltar para o app depois de mais de 1 minuto, relê", () => {
    const doc = documentoFalso();
    const reler = vi.fn();
    vigiarSituacao(reler, { documento: doc as unknown as Document, agora: () => agora });
    doc.mudar("hidden");
    agora += 5 * 60 * 1000;
    doc.mudar("visible");
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("não relê logo depois da entrada, nem duas vezes em menos de 1 minuto, nem com o app escondido", () => {
    const doc = documentoFalso();
    const reler = vi.fn();
    vigiarSituacao(reler, { documento: doc as unknown as Document, agora: () => agora });
    agora += 10_000;
    doc.mudar("visible");
    expect(reler).not.toHaveBeenCalled();
    agora += RELEITURA_ESPERA_MINIMA_MS;
    doc.mudar("hidden");
    expect(reler).not.toHaveBeenCalled();
    doc.mudar("visible");
    doc.mudar("visible");
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("de 15 em 15 minutos com o app na tela, e nunca com ele escondido", () => {
    const doc = documentoFalso();
    const reler = vi.fn();
    vigiarSituacao(reler, { documento: doc as unknown as Document, agora: () => agora });
    agora += RELEITURA_INTERVALO_MS;
    vi.advanceTimersByTime(RELEITURA_INTERVALO_MS);
    expect(reler).toHaveBeenCalledTimes(1);
    doc.visibilityState = "hidden";
    agora += RELEITURA_INTERVALO_MS;
    vi.advanceTimersByTime(RELEITURA_INTERVALO_MS);
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("desligar tira o ouvinte e o relógio", () => {
    const doc = documentoFalso();
    const reler = vi.fn();
    const desligar = vigiarSituacao(reler, { documento: doc as unknown as Document, agora: () => agora });
    desligar();
    expect(doc.ouvintes.size).toBe(0);
    agora += 2 * RELEITURA_INTERVALO_MS;
    vi.advanceTimersByTime(2 * RELEITURA_INTERVALO_MS);
    expect(reler).not.toHaveBeenCalled();
  });

  it("a espera mínima é de 1 minuto e o intervalo, longo", () => {
    expect(deveReler(0, RELEITURA_ESPERA_MINIMA_MS - 1)).toBe(false);
    expect(deveReler(0, RELEITURA_ESPERA_MINIMA_MS)).toBe(true);
    // Mais curto que isso vira consulta a cada tela.
    expect(RELEITURA_INTERVALO_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it("o AuthContext liga a releitura enquanto há aluno na sessão", () => {
    const texto = readFileSync(join(__dirname, "..", "contexts", "AuthContext.tsx"), "utf8");
    expect(texto).toMatch(/return vigiarSituacao\(/);
    expect(texto).toMatch(/lerSituacao\(alunoId\)/);
  });
});

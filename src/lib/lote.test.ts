import { describe, it, expect, vi } from "vitest";
import { processarComLimite } from "./lote";

describe("processarComLimite", () => {
  it("processa todos os itens", async () => {
    const r = await processarComLimite([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(r.map((x) => (x.ok ? x.item : null))).toEqual([10, 20, 30, 40, 50]);
  });

  it("preserva a ordem da entrada mesmo quando terminam fora de ordem", async () => {
    // O primeiro item demora mais que os outros de propósito: sem o
    // posicionamento por índice, ele apareceria por último no resultado e
    // casar resultado com linha da planilha viraria adivinhação.
    const atrasos = [30, 1, 1, 1];
    const r = await processarComLimite(atrasos, 4, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return i;
    });
    expect(r.map((x) => (x.ok ? x.item : null))).toEqual([0, 1, 2, 3]);
  });

  it("nunca ultrapassa o limite de tarefas em voo", async () => {
    let emVoo = 0;
    let pico = 0;

    await processarComLimite(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((resolve) => setTimeout(resolve, 2));
      emVoo--;
    });

    // O limite existe por causa do teto de envio de e-mail do Supabase
    // Auth: estourar transforma linha boa em erro.
    expect(pico).toBeLessThanOrEqual(3);
    expect(pico).toBeGreaterThan(1);
  });

  it("uma linha ruim não derruba o lote", async () => {
    const r = await processarComLimite([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("e-mail inválido");
      return n;
    });

    expect(r[0].ok).toBe(true);
    expect(r[1].ok).toBe(false);
    expect(r[2].ok).toBe(true);
    expect(r[1].ok === false && r[1].erro.message).toBe("e-mail inválido");
  });

  it("converte valor lançado que não é Error, sem quebrar quem consome", async () => {
    const r = await processarComLimite([1], 1, async () => {
      throw "falha crua";
    });
    expect(r[0].ok).toBe(false);
    expect(r[0].ok === false && r[0].erro).toBeInstanceOf(Error);
  });

  it("avisa o progresso item a item, para a tela avançar durante o lote", async () => {
    const aoConcluir = vi.fn();
    await processarComLimite([1, 2, 3], 2, async (n) => n, aoConcluir);
    expect(aoConcluir).toHaveBeenCalledTimes(3);
  });

  it("lida com lista vazia sem travar", async () => {
    const r = await processarComLimite([], 3, async (n) => n);
    expect(r).toEqual([]);
  });

  it("recusa limite inválido em vez de rodar sequencial em silêncio", async () => {
    await expect(processarComLimite([1], 0, async (n) => n)).rejects.toThrow("pelo menos 1");
  });
});

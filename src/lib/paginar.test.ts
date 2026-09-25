import { describe, expect, it } from "vitest";
import { porLotes, todasAsLinhas } from "./paginar";

describe("todasAsLinhas", () => {
  it("lê de mil em mil até a página vir incompleta", async () => {
    const pedidos: [number, number][] = [];
    const linhas = await todasAsLinhas<number>(async (de, ate) => {
      pedidos.push([de, ate]);
      const fim = Math.min(ate, 1499);
      return { data: Array.from({ length: Math.max(0, fim - de + 1) }, (_, i) => de + i), error: null };
    });
    expect(linhas).toHaveLength(1500);
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("erro da consulta vira erro, não lista vazia", async () => {
    await expect(todasAsLinhas(async () => ({ data: null, error: { message: "permission denied" } }))).rejects.toThrow("permission denied");
  });
});

describe("porLotes", () => {
  it("manda os ids em lotes de 200, sem repetir, e junta os resultados", async () => {
    const lotes: number[] = [];
    const ids = [...Array.from({ length: 750 }, (_, i) => `u${i}`), "u1", "u2"];
    const linhas = await porLotes(ids, async (lote) => {
      lotes.push(lote.length);
      return { data: lote.map((id) => ({ id })), error: null };
    });
    expect(lotes).toEqual([200, 200, 200, 150]);
    expect(linhas).toHaveLength(750);
  });

  it("lista vazia não consulta nada", async () => {
    let chamadas = 0;
    expect(await porLotes([], async () => ((chamadas++), { data: [], error: null }))).toEqual([]);
    expect(chamadas).toBe(0);
  });

  it("aceita um lote que pagina por conta própria", async () => {
    const linhas = await porLotes(["a", "b"], async (lote) => lote.flatMap((id) => [`${id}1`, `${id}2`]));
    expect(linhas).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("um lote com erro derruba a leitura inteira", async () => {
    await expect(
      porLotes(Array.from({ length: 300 }, (_, i) => i), async (lote) =>
        lote[0] === 200 ? { data: null, error: { message: "falhou" } } : { data: lote, error: null },
      ),
    ).rejects.toThrow("falhou");
  });
});

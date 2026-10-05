import { describe, expect, it } from "vitest";
import { exigirGravacao, NADA_GRAVADO } from "./gravacao";

const resposta = <T,>(data: T[] | null, error: { message: string; code: string } | null = null) =>
  Promise.resolve({ data, error: error as never });

describe("exigirGravacao", () => {
  it("devolve as linhas gravadas", async () => {
    await expect(exigirGravacao(resposta([{ id: "a" }]))).resolves.toEqual([{ id: "a" }]);
  });

  it("zero linhas é falha, com a mensagem padrão ou a escolhida", async () => {
    await expect(exigirGravacao(resposta([]))).rejects.toThrow(NADA_GRAVADO);
    await expect(exigirGravacao(resposta(null))).rejects.toThrow(NADA_GRAVADO);
    await expect(exigirGravacao(resposta([]), "Só a gestão altera.")).rejects.toThrow("Só a gestão altera.");
  });

  it("o erro do banco passa adiante como veio, com o código", async () => {
    await expect(exigirGravacao(resposta(null, { message: "duplicate key", code: "23505" }))).rejects.toMatchObject({ code: "23505" });
  });
});

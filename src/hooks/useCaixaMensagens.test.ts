import { describe, it, expect } from "vitest";
import { canaisDoPapel } from "./useCaixaMensagens";

describe("canais da caixa de mensagens por papel", () => {
  it("professor atende o chat de treino, nutricionista o de dieta", () => {
    expect(canaisDoPapel("professor")).toEqual(["treino"]);
    expect(canaisDoPapel("nutricionista")).toEqual(["dieta"]);
  });

  it("gestor, recepção e sem papel veem os dois", () => {
    expect(canaisDoPapel("gestor")).toEqual(["treino", "dieta"]);
    expect(canaisDoPapel("recepcao")).toEqual(["treino", "dieta"]);
    expect(canaisDoPapel(null)).toEqual(["treino", "dieta"]);
  });
});

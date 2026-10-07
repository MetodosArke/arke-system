import { describe, it, expect } from "vitest";
import { canaisDoPapel } from "./useCaixaMensagens";

describe("canais da caixa de mensagens por papel", () => {
  it("professor atende o chat de treino, nutricionista o de dieta", () => {
    expect(canaisDoPapel("professor")).toEqual(["treino"]);
    expect(canaisDoPapel("nutricionista")).toEqual(["dieta"]);
  });

  it("a recepção vê só o de treino: a conversa da nutrição é saúde (20261399010000)", () => {
    expect(canaisDoPapel("recepcao")).toEqual(["treino"]);
  });

  it("gestor e sem papel veem os dois (o banco decide o que cada um recebe)", () => {
    expect(canaisDoPapel("gestor")).toEqual(["treino", "dieta"]);
    expect(canaisDoPapel(null)).toEqual(["treino", "dieta"]);
  });
});

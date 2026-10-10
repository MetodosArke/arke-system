import { describe, it, expect } from "vitest";
import { atalhoDeConversa, destinoDoEvento, CONVERSA_COM_A_ACADEMIA, CONVERSA_COM_O_MENTOR } from "./eventoAcompanhamento";

describe("destinoDoEvento", () => {
  it("no Método leva à Jornada, que começa no Acolhimento M.A.P.A.®", () => {
    expect(destinoDoEvento("integrado")).toEqual({ rota: "/app/jornada" });
    expect(destinoDoEvento("elite")).toEqual({ rota: "/app/jornada" });
  });

  it("no Free não leva à Jornada, que ali é só o convite do Método", () => {
    expect(destinoDoEvento("free")).toEqual({ rota: "/app/treinos", rolarPara: CONVERSA_COM_A_ACADEMIA });
  });
});

describe("atalhoDeConversa", () => {
  it("no Método abre a conversa com o mentor", () => {
    expect(atalhoDeConversa("integrado")).toEqual({ rota: "/app/treinos", rolarPara: CONVERSA_COM_O_MENTOR });
    expect(atalhoDeConversa("elite")).toEqual({ rota: "/app/treinos", rolarPara: CONVERSA_COM_O_MENTOR });
  });

  it("no Free não há atalho: o aluno sem Método não tem mentor", () => {
    expect(atalhoDeConversa("free")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { atalhoDeConversa, destinoDoEvento, CONVERSA_COM_A_ACADEMIA, CONVERSA_COM_O_MENTOR, TITULO_DO_EVENTO } from "./eventoAcompanhamento";

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

describe("o texto do cartão", () => {
  it("é para o aluno, e não o motivo da tarefa, que é instrução da equipe", () => {
    expect(TITULO_DO_EVENTO).not.toMatch(/anamnese|prescrever/i);
    const home = readFileSync(join(__dirname, "..", "pages", "app", "AlunoDashboard.tsx"), "utf8");
    expect(home).toContain("{TITULO_DO_EVENTO}");
    expect(home).not.toMatch(/proximoEvento\??\.motivo/);
  });
});

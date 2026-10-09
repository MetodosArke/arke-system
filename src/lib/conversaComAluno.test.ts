import { describe, expect, it } from "vitest";
import { canaisDaConversaComAluno, type ContextoConversa } from "./conversaComAluno";

const contexto = (c: Partial<ContextoConversa>): ContextoConversa => ({
  papel: "gestor",
  veSaude: true,
  plano: "free",
  academiaTemNutri: true,
  ...c,
});

describe("com quem da academia o aluno conversa (botão Mensagem da fila)", () => {
  it("o professor conversa no canal do treino, e só nele", () => {
    expect(canaisDaConversaComAluno(contexto({ papel: "professor" }))).toEqual(["treino"]);
  });

  it("a recepção nunca abre o chat da nutrição, nem com nutricionista na equipe", () => {
    expect(canaisDaConversaComAluno(contexto({ papel: "recepcao", veSaude: false }))).toEqual(["treino"]);
    // Mesmo se o papel viesse sem o canal da dieta filtrado, quem não atende a saúde não recebe a nutrição.
    expect(canaisDaConversaComAluno(contexto({ papel: "gestor", veSaude: false }))).toEqual(["treino"]);
  });

  it("a nutricionista conversa no canal da nutrição", () => {
    expect(canaisDaConversaComAluno(contexto({ papel: "nutricionista" }))).toEqual(["nutri"]);
  });

  it("a gestão atende os dois canais, o do treino primeiro", () => {
    expect(canaisDaConversaComAluno(contexto({}))).toEqual(["treino", "nutri"]);
  });

  it("sem nutricionista na equipe, o chat da nutrição do Free não abre (é o do Método)", () => {
    expect(canaisDaConversaComAluno(contexto({ academiaTemNutri: false }))).toEqual(["treino"]);
    expect(canaisDaConversaComAluno(contexto({ papel: "nutricionista", academiaTemNutri: false }))).toEqual([]);
  });

  it("aluno do Método não conversa com a academia: treino e dieta são do mentor da ArkeFit", () => {
    for (const plano of ["integrado", "elite"] as const) {
      for (const papel of ["gestor", "professor", "nutricionista", "recepcao", null]) {
        expect(canaisDaConversaComAluno(contexto({ plano, papel })), `${plano}/${papel}`).toEqual([]);
      }
    }
  });
});

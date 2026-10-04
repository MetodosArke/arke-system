import { describe, expect, it } from "vitest";
import {
  caminhoDoApp,
  papeisDaEquipe,
  podeAvisarPessoa,
  TEXTO_MAXIMO,
  textoDoAviso,
  TITULO_MAXIMO,
} from "../../supabase/functions/send-chat-push/regras";

describe("aviso no celular: quem avisa quem", () => {
  it("a equipe avisa o aluno e outra pessoa da equipe", () => {
    expect(podeAvisarPessoa("professor", "aluno")).toBe(true);
    expect(podeAvisarPessoa("gestor", "recepcao")).toBe(true);
  });

  it("o aluno avisa a equipe, mas nunca outro aluno", () => {
    expect(podeAvisarPessoa("aluno", "professor")).toBe(true);
    expect(podeAvisarPessoa("aluno", "aluno")).toBe(false);
  });

  it("sem vínculo na academia, ninguém avisa ninguém", () => {
    expect(podeAvisarPessoa(null, "aluno")).toBe(false);
    expect(podeAvisarPessoa("professor", null)).toBe(false);
  });

  it("aviso em massa só vai para papéis da equipe", () => {
    expect(papeisDaEquipe(["professor", "aluno", "gestor", "gestor", 3])).toEqual(["professor", "gestor"]);
    expect(papeisDaEquipe(["aluno"])).toEqual([]);
    expect(papeisDaEquipe("aluno")).toEqual([]);
  });
});

describe("aviso no celular: o link fica no app", () => {
  it("caminho do app passa", () => {
    expect(caminhoDoApp("/#/app/treinos")).toBe("/#/app/treinos");
    expect(caminhoDoApp("/")).toBe("/");
  });

  it("endereço de fora vira a página inicial", () => {
    for (const url of [
      "https://golpe.example/pague",
      "//golpe.example/pague",
      "/\\golpe.example",
      "javascript:alert(1)",
      "/https://golpe.example",
      "/ ok",
      "",
      42,
      undefined,
      "/" + "a".repeat(300),
    ]) {
      expect(caminhoDoApp(url), String(url)).toBe("/");
    }
  });
});

describe("aviso no celular: texto com tamanho máximo", () => {
  it("corta e junta em uma linha", () => {
    const titulo = textoDoAviso("x".repeat(500), TITULO_MAXIMO);
    expect(titulo.length).toBe(TITULO_MAXIMO);
    expect(titulo.endsWith("…")).toBe(true);
    expect(textoDoAviso("Oi\n\n  professor", TEXTO_MAXIMO)).toBe("Oi professor");
  });

  it("texto que não é texto fica vazio, e a função recusa", () => {
    expect(textoDoAviso({ a: 1 }, TEXTO_MAXIMO)).toBe("");
    expect(textoDoAviso("   ", TEXTO_MAXIMO)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  AVISO_DO_MENTOR,
  caminhoDoApp,
  destinoNoCanalMentor,
  JANELA_MENSAGEM_SEG,
  mensagemRecente,
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

describe("aviso no celular: a conversa com o mentor ARKE (10/10/2026)", () => {
  const aluno = { user_id: "u-aluno", mentor_id: "u-mentora" };
  const equipe = ["u-socio", "u-mentora", "u-mentor2"];

  it("o mentor escreveu: avisa o aluno", () => {
    expect(destinoNoCanalMentor("mentor", aluno, equipe, true)).toEqual(["u-aluno"]);
    expect(destinoNoCanalMentor("mentor", { ...aluno, user_id: null }, equipe, true)).toEqual([]);
  });

  it("o aluno escreveu: avisa o mentor dele; sem mentor (ou com um que saiu), a equipe da Mentoria", () => {
    expect(destinoNoCanalMentor("aluno", aluno, equipe, true)).toEqual(["u-mentora"]);
    expect(destinoNoCanalMentor("aluno", { ...aluno, mentor_id: null }, equipe, true)).toEqual(equipe);
    expect(destinoNoCanalMentor("aluno", { ...aluno, mentor_id: "u-saiu" }, equipe, true)).toEqual(equipe);
  });

  it("aluno fora do Método não avisa ninguém, nem remetente estranho", () => {
    expect(destinoNoCanalMentor("aluno", aluno, equipe, false)).toEqual([]);
    expect(destinoNoCanalMentor("treinador", aluno, equipe, true)).toEqual([]);
    expect(destinoNoCanalMentor(undefined, aluno, equipe, true)).toEqual([]);
  });

  it("o aviso sai só para a mensagem recém-gravada", () => {
    const agora = Date.parse("2026-10-10T12:00:00Z");
    expect(mensagemRecente("2026-10-10T11:59:30Z", agora)).toBe(true);
    expect(mensagemRecente(new Date(agora - (JANELA_MENSAGEM_SEG + 1) * 1000).toISOString(), agora)).toBe(false);
    expect(mensagemRecente("2026-10-10T12:05:00Z", agora)).toBe(false);
    expect(mensagemRecente("lixo", agora)).toBe(false);
    expect(mensagemRecente(null, agora)).toBe(false);
  });

  it("o texto é fixo, sem trecho da mensagem, e o link fica no app", () => {
    for (const a of Object.values(AVISO_DO_MENTOR)) {
      expect(caminhoDoApp(a.url)).toBe(a.url);
      expect(a.title.length).toBeLessThanOrEqual(TITULO_MAXIMO);
      expect(a.body.length).toBeLessThanOrEqual(TEXTO_MAXIMO);
    }
  });
});

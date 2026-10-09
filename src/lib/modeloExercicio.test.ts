import { describe, expect, it } from "vitest";
import { devePerguntarModelo, escolherMidiaExercicio, lerModelo } from "./modeloExercicio";

const OS_DOIS = { gif_masculino_url: "https://m.gif", gif_feminino_url: "https://f.gif", gif_url: "https://unico.gif" };

describe("escolherMidiaExercicio", () => {
  it("mostra o GIF do modelo escolhido", () => {
    expect(escolherMidiaExercicio(OS_DOIS, "feminino")).toMatchObject({ imagemUrl: "https://f.gif", modeloMostrado: "feminino", temOsDois: true });
    expect(escolherMidiaExercicio(OS_DOIS, "masculino")).toMatchObject({ imagemUrl: "https://m.gif", modeloMostrado: "masculino" });
  });

  it("sem escolha, mostra o masculino", () => {
    expect(escolherMidiaExercicio(OS_DOIS, null)).toMatchObject({ imagemUrl: "https://m.gif", modeloMostrado: "masculino" });
  });

  it("sem o GIF do modelo escolhido, mostra o do outro", () => {
    expect(escolherMidiaExercicio({ gif_masculino_url: "https://m.gif", gif_url: "https://u.gif" }, "feminino")).toMatchObject({
      imagemUrl: "https://m.gif",
      modeloMostrado: "masculino",
      temOsDois: false,
    });
    expect(escolherMidiaExercicio({ gif_feminino_url: "https://f.gif" }, null)).toMatchObject({ imagemUrl: "https://f.gif", modeloMostrado: "feminino" });
  });

  it("sem nenhum dos dois, mostra o gif_url; e texto vazio conta como ausente", () => {
    expect(escolherMidiaExercicio({ gif_url: "https://u.gif", gif_feminino_url: " " }, "feminino")).toEqual({
      imagemUrl: "https://u.gif",
      videoUrl: null,
      modeloMostrado: null,
      temOsDois: false,
    });
    expect(escolherMidiaExercicio({}, null).imagemUrl).toBeNull();
  });

  it("o vídeo segue como antes, qualquer que seja o modelo", () => {
    expect(escolherMidiaExercicio({ ...OS_DOIS, video_url: "https://v.mp4" }, "feminino").videoUrl).toBe("https://v.mp4");
  });
});

describe("lerModelo", () => {
  it("aceita só os dois valores", () => {
    expect(lerModelo("feminino")).toBe("feminino");
    expect(lerModelo("masculino")).toBe("masculino");
    expect(lerModelo("outro")).toBeNull();
    expect(lerModelo(null)).toBeNull();
  });
});

describe("devePerguntarModelo", () => {
  const carregada = { carregada: true, pulou: false };
  it("pergunta a quem não escolheu, quando algum exercício tem os dois modelos", () => {
    expect(devePerguntarModelo(null, carregada, [{ gif_url: "x" }, OS_DOIS])).toBe(true);
  });
  it("não pergunta sem os dois modelos, depois da escolha, depois de pular ou antes de ler a escolha", () => {
    expect(devePerguntarModelo(null, carregada, [{ gif_masculino_url: "m" }, { gif_url: "x" }])).toBe(false);
    expect(devePerguntarModelo("feminino", carregada, [OS_DOIS])).toBe(false);
    expect(devePerguntarModelo(null, { carregada: true, pulou: true }, [OS_DOIS])).toBe(false);
    expect(devePerguntarModelo(null, { carregada: false, pulou: false }, [OS_DOIS])).toBe(false);
  });
});

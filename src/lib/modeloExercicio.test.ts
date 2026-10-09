import { describe, expect, it } from "vitest";
import {
  devePerguntarModelo,
  escolherMidiaExercicio,
  exercicioDoAcervo,
  globaisPorNome,
  lerModelo,
  nomesSemVinculo,
  type GifsDoAcervo,
} from "./modeloExercicio";

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

describe("exercicioDoAcervo (o item sem vínculo casa pelo nome)", () => {
  const global = (id: string, nome: string): GifsDoAcervo => ({
    id,
    nome,
    organization_id: null,
    gif_masculino_url: `https://${id}-m.gif`,
    gif_feminino_url: `https://${id}-f.gif`,
  });
  const LEG = global("leg", "Leg press 45°");
  const PUXADA = global("puxada", "Puxada frontal (pulley)");
  const DA_ACADEMIA: GifsDoAcervo = { ...global("proprio", "Rosca martelo"), organization_id: "org-1" };
  const acervo = [LEG, PUXADA, DA_ACADEMIA];
  const porId = new Map(acervo.map((e) => [e.id, e]));
  const porNome = globaisPorNome(acervo);

  it("com exercicio_id, usa o vínculo", () => {
    expect(exercicioDoAcervo({ exercicio_id: "puxada", nome_exercicio: "Leg press 45°" }, porId, porNome)).toBe(PUXADA);
  });

  it("sem exercicio_id, usa o global de nome exato", () => {
    expect(exercicioDoAcervo({ exercicio_id: null, nome_exercicio: "Leg press 45°" }, porId, porNome)).toBe(LEG);
    expect(exercicioDoAcervo({ nome_exercicio: "Puxada frontal (pulley)" }, porId, porNome)).toBe(PUXADA);
  });

  it("o nome precisa ser exato: maiúscula, espaço ou outra grafia não casam", () => {
    for (const nome of ["leg press 45°", "Leg press 45° ", "Leg press 45", "Leg Press"]) {
      expect(exercicioDoAcervo({ nome_exercicio: nome }, porId, porNome)).toBeUndefined();
    }
  });

  it("só o acervo global: o exercício próprio de uma academia não casa pelo nome", () => {
    expect(porNome.has("Rosca martelo")).toBe(false);
    expect(exercicioDoAcervo({ nome_exercicio: "Rosca martelo" }, porId, porNome)).toBeUndefined();
  });

  it("nome repetido entre os globais não casa (sem um único par)", () => {
    const repetido = globaisPorNome([LEG, global("leg-2", "Leg press 45°"), PUXADA]);
    expect(repetido.has("Leg press 45°")).toBe(false);
    expect(repetido.get("Puxada frontal (pulley)")).toBe(PUXADA);
  });

  it("sem par, nada: o item fica com a mídia que já tem", () => {
    expect(exercicioDoAcervo({ nome_exercicio: "Exercício inventado" }, porId, porNome)).toBeUndefined();
    expect(exercicioDoAcervo({ nome_exercicio: null }, porId, porNome)).toBeUndefined();
    expect(exercicioDoAcervo({}, porId, porNome)).toBeUndefined();
  });

  it("o item com vínculo que o acervo não devolve não casa pelo nome", () => {
    expect(exercicioDoAcervo({ exercicio_id: "apagado", nome_exercicio: "Leg press 45°" }, porId, porNome)).toBeUndefined();
  });

  it("lê pelo nome só os itens sem vínculo, sem repetir", () => {
    expect(
      nomesSemVinculo([
        { exercicio_id: "puxada", nome_exercicio: "Puxada frontal (pulley)" },
        { exercicio_id: null, nome_exercicio: "Leg press 45°" },
        { nome_exercicio: "Leg press 45°" },
        { nome_exercicio: "" },
      ]),
    ).toEqual(["Leg press 45°"]);
  });
});

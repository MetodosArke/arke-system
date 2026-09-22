import { describe, it, expect } from "vitest";
import { caminhoDaMidia, embedYoutube, idYoutube, tipoDoVideo, validarArquivo } from "./midiaExercicio";

describe("mídia de exercício", () => {
  it("reconhece os formatos comuns de link do YouTube", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
    ]) {
      expect(idYoutube(url)).toBe("dQw4w9WgXcQ");
    }
  });

  it("YouTube vira player embutido, sem som", () => {
    expect(embedYoutube("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?mute=1&rel=0&playsinline=1"
    );
  });

  it("arquivo do armazenamento é vídeo próprio", () => {
    expect(tipoDoVideo("https://x.supabase.co/storage/v1/object/public/exercicio-videos/org/a.mp4")).toBe("video_arquivo");
    expect(tipoDoVideo(null)).toBe("nenhuma");
  });

  it("caminho fica na pasta do dono e mantém a extensão", () => {
    expect(caminhoDaMidia("global", "Supino.MP4")).toMatch(/^global\/[0-9a-f-]{36}\.mp4$/);
  });

  it("recusa tipo errado e arquivo grande demais", () => {
    expect(validarArquivo({ size: 1000, type: "application/pdf" }, "video")).toMatch(/MP4/);
    expect(validarArquivo({ size: 20 * 1024 * 1024, type: "video/mp4" }, "video")).toMatch(/15 MB/);
    expect(validarArquivo({ size: 1000, type: "image/gif" }, "imagem")).toBeNull();
  });
});

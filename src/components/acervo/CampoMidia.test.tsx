import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { CampoMidia } from "./CampoMidia";

const upload = vi.fn();
const reduzir = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => upload(...a),
        getPublicUrl: (caminho: string) => ({ data: { publicUrl: `https://exemplo/${caminho}` } }),
      }),
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/removerAudio", () => ({ removerAudio: async (f: File) => ({ arquivo: f, semAudio: true }) }));
// O canvas não existe no jsdom: a redução de verdade é conferida no navegador.
// Aqui se confere a ligação: quem passa por ela e o que sobe depois.
vi.mock("@/lib/reduzirImagem", async (original) => ({
  ...(await original<typeof import("@/lib/reduzirImagem")>()),
  reduzirImagem: (...a: unknown[]) => reduzir(...a),
}));

function escolher(container: HTMLElement, arquivo: File) {
  const entrada = container.querySelector('input[accept="image/png,image/jpeg,image/webp,image/gif"]') as HTMLInputElement;
  fireEvent.change(entrada, { target: { files: [arquivo] } });
}

describe("imagem do exercício", () => {
  beforeEach(() => {
    upload.mockReset().mockResolvedValue({ error: null });
    reduzir.mockReset();
  });

  it("PNG sobe reduzido, como WebP, com cache de um ano", async () => {
    reduzir.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
    const onChange = vi.fn();
    const { container } = render(<CampoMidia pasta="org-1" videoUrl="" imagemUrl="" nome="Agachamento" onChange={onChange} />);
    escolher(container, new File(["png grande"], "agachamento.png", { type: "image/png" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(reduzir).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ ladoMaior: 1200, tipo: "image/webp" }));
    const [caminho, arquivo, opcoes] = upload.mock.calls[0] as [string, File, Record<string, unknown>];
    expect(caminho).toMatch(/^org-1\/[0-9a-f-]+\.webp$/);
    expect(arquivo.type).toBe("image/webp");
    expect(arquivo.name).toBe("agachamento.webp");
    expect(opcoes).toMatchObject({ contentType: "image/webp", cacheControl: "31536000", upsert: false });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ gif_url: expect.stringMatching(/\.webp$/) }));
  });

  it("GIF sobe como veio, para não perder a animação", async () => {
    const { container } = render(<CampoMidia pasta="org-1" videoUrl="" imagemUrl="" nome="Agachamento" onChange={vi.fn()} />);
    escolher(container, new File(["gif"], "agachamento.gif", { type: "image/gif" }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(reduzir).not.toHaveBeenCalled();
    const [caminho, arquivo] = upload.mock.calls[0] as [string, File];
    expect(caminho).toMatch(/\.gif$/);
    expect(arquivo.type).toBe("image/gif");
  });

  it("imagem que não ganharia nada sobe como veio", async () => {
    const original = new File(["jpg pequeno"], "pequena.jpg", { type: "image/jpeg" });
    reduzir.mockResolvedValue(original);
    const { container } = render(<CampoMidia pasta="org-1" videoUrl="" imagemUrl="" nome="Agachamento" onChange={vi.fn()} />);
    escolher(container, original);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const [caminho, arquivo] = upload.mock.calls[0] as [string, File];
    expect(arquivo).toBe(original);
    expect(caminho).toMatch(/\.jpg$/);
  });
});

import { describe, expect, it } from "vitest";
import { MANIFESTO_ARKEFIT, montarManifesto, nomeCurto, slugDoPedido } from "../../supabase/functions/manifest-academia/fluxo";
import { LADO_DO_LOGO, encaixarLogo } from "./iconeApp";
import manifestoPublico from "../../public/manifest.json";

const marca = { nome: "Academia Horizonte", slug: "horizonte", icone_192: "https://x.supabase.co/i192.png", icone_512: "https://x.supabase.co/i512.png" };

describe("manifesto do app com a marca da academia", () => {
  it("cada academia é um app à parte, que abre na entrada dela", () => {
    const m = montarManifesto(marca);
    expect(m.id).toBe("/?academia=horizonte");
    expect(m.start_url).toBe("/?academia=horizonte");
    expect(m.scope).toBe("/");
    expect(m.name).toBe("Academia Horizonte");
    expect(m.display).toBe("standalone");
  });

  it("os ícones da academia, com o maskable para o Android", () => {
    const icones = montarManifesto(marca).icons as { src: string; sizes: string; purpose: string }[];
    expect(icones.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    expect(icones[0].src).toBe(marca.icone_192);
  });

  it("sem ícone gerado, o nome da academia com o ícone da ArkeFit", () => {
    const m = montarManifesto({ ...marca, icone_192: null, icone_512: null });
    expect(m.name).toBe("Academia Horizonte");
    expect((m.icons as { src: string }[])[0].src).toBe("/pwa-icon-192.png");
  });

  it("ícone que não é https não entra", () => {
    const m = montarManifesto({ ...marca, icone_192: "http://x/i.png" });
    expect((m.icons as { src: string }[])[0].src).toBe("/pwa-icon-192.png");
  });

  it("academia que não existe volta a ser a ArkeFit, igual ao manifesto do site", () => {
    const m = montarManifesto(null);
    expect(m).toBe(MANIFESTO_ARKEFIT);
    expect({ ...m, id: undefined }).toMatchObject({ ...manifestoPublico });
  });

  it("o nome embaixo do ícone tira o que não distingue", () => {
    expect(nomeCurto("Academia Horizonte")).toBe("Horizonte");
    expect(nomeCurto("Tietê Fitness")).toBe("Tietê Fitness");
    expect(nomeCurto("Studio de Pilates Bem-Estar Total")).toBe("Pilates");
    expect(nomeCurto("Supercalifragilisticexpialidocious")).toBe("Supercalifragil");
  });

  it("o slug sai do caminho ou do parâmetro, e lixo não passa", () => {
    expect(slugDoPedido(new URL("https://x/functions/v1/manifest-academia/horizonte"))).toBe("horizonte");
    expect(slugDoPedido(new URL("https://x/functions/v1/manifest-academia?slug=Horizonte"))).toBe("horizonte");
    expect(slugDoPedido(new URL("https://x/functions/v1/manifest-academia"))).toBeNull();
    expect(slugDoPedido(new URL("https://x/functions/v1/manifest-academia/%3Cscript%3E"))).toBeNull();
  });
});

describe("ícone do app gerado do logo", () => {
  it("logo largo cabe inteiro na margem segura, centrado", () => {
    const r = encaixarLogo(400, 100, 512);
    expect(r.w).toBeCloseTo(512 * LADO_DO_LOGO);
    expect(r.h).toBeCloseTo((512 * LADO_DO_LOGO) / 4);
    expect(r.x + r.w / 2).toBeCloseTo(256);
    expect(r.y + r.h / 2).toBeCloseTo(256);
  });

  it("o logo fica dentro do círculo que o Android garante (80% do lado)", () => {
    for (const [w, h] of [[100, 100], [400, 100], [100, 400]]) {
      const r = encaixarLogo(w, h, 512);
      const cantos = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      for (const [cx, cy] of cantos) expect(Math.hypot(cx - 256, cy - 256)).toBeLessThanOrEqual(512 * 0.4);
    }
  });

  it("SVG sem tamanho próprio vira quadrado", () => {
    const r = encaixarLogo(0, 0, 192);
    expect(r.w).toBeCloseTo(r.h);
  });
});

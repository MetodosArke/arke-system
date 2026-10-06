import { describe, expect, it } from "vitest";
import {
  CONTRASTE_MINIMO,
  FUNDOS,
  FUNDOS_DO_TEXTO,
  contraste,
  coresDaMarca,
  cssDaMarca,
  lerHex,
  linkDeEntrada,
  normalizarHex,
  slugDeEntrada,
  hslDe,
  textoSobre,
  tomParaOTema,
  tomParaTexto,
} from "./marcaAcademia";

const pior = (hex: string, tema: "claro" | "escuro") => Math.min(...FUNDOS[tema].map((f) => contraste(lerHex(hex)!, f)));

describe("cor da academia", () => {
  it("lê e normaliza o hexadecimal", () => {
    expect(normalizarHex("#ABC")).toBe("#aabbcc");
    expect(normalizarHex(" #1A2b3C ")).toBe("#1a2b3c");
    expect(normalizarHex("azul")).toBeNull();
    expect(normalizarHex("#12345")).toBeNull();
    expect(normalizarHex(null)).toBeNull();
  });

  it("contraste da WCAG: preto e branco dão 21", () => {
    expect(contraste(lerHex("#000")!, lerHex("#fff")!)).toBeCloseTo(21, 5);
  });

  it("cor que já se lê nos dois temas fica como está", () => {
    const azul = coresDaMarca("#1e6fd9")!;
    expect(azul.claro.ajustado).toBe(false);
    expect(azul.escuro.ajustado).toBe(false);
    expect(azul.claro.cor).toBe("#1e6fd9");
    expect(azul.escuro.cor).toBe("#1e6fd9");
  });

  it("amarelo no tema claro é escurecido até dar leitura, e no escuro fica", () => {
    const amarelo = coresDaMarca("#ffc700")!;
    expect(amarelo.escuro.ajustado).toBe(false);
    expect(amarelo.claro.ajustado).toBe(true);
    expect(pior(amarelo.claro.cor, "claro")).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
  });

  it("azul-marinho no tema escuro é clareado até dar leitura", () => {
    const marinho = coresDaMarca("#0b1f4d")!;
    expect(marinho.claro.ajustado).toBe(false);
    expect(marinho.escuro.ajustado).toBe(true);
    expect(pior(marinho.escuro.cor, "escuro")).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
  });

  it("toda cor sai com contraste nos dois temas", () => {
    for (const hex of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#777777", "#f5f5dc", "#111111", "#ffc700"]) {
      const c = coresDaMarca(hex)!;
      expect(pior(c.claro.cor, "claro"), `${hex} claro`).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
      expect(pior(c.escuro.cor, "escuro"), `${hex} escuro`).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    }
  });

  it("num tom médio nem o escuro nem o branco chegam a 4,5: o tom anda até chegar", () => {
    const cinza = lerHex("#777777")!;
    expect(contraste(cinza, textoSobre(cinza))).toBeLessThan(4.5);
    for (const tema of ["claro", "escuro"] as const) {
      const t = coresDaMarca("#777777")![tema];
      expect(t.ajustado).toBe(true);
      const c = lerHex(t.cor)!;
      expect(contraste(c, textoSobre(c)), tema).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("o texto do botão sempre passa de 4,5, nos dois temas", () => {
    for (const hex of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#777777", "#808080", "#ffc700", "#1e6fd9", "#e91e63", "#00a86b"]) {
      for (const tema of ["claro", "escuro"] as const) {
        const c = lerHex(coresDaMarca(hex)![tema].cor)!;
        expect(contraste(c, textoSobre(c)), `${hex} ${tema}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("a cor usada como texto passa de 4,5 sobre o fundo, o cartão e o muted, nos dois temas", () => {
    for (const hex of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#777777", "#ffc700", "#d9a520", "#1e6fd9", "#e91e63", "#00a86b"]) {
      for (const tema of ["claro", "escuro"] as const) {
        const t = coresDaMarca(hex)![tema];
        const c = lerHex(t.corTexto)!;
        for (const fundo of FUNDOS_DO_TEXTO[tema]) expect(contraste(c, fundo), `${hex} ${tema}`).toBeGreaterThanOrEqual(4.5);
        expect(t.tokens["--primary-texto"]).toBe(hslDe(c));
      }
    }
    // O azul escuro já passa no claro e fica como está.
    expect(tomParaTexto(lerHex("#1e3a8a")!, "claro")).toEqual(lerHex("#1e3a8a"));
  });

  it("o texto acompanha a cor: escuro no amarelo, branco no azul", () => {
    expect(coresDaMarca("#ffc700")!.escuro.tokens["--primary-foreground"]).toBe("0 0% 5.1%");
    expect(coresDaMarca("#1e6fd9")!.claro.tokens["--primary-foreground"]).toBe("0 0% 100%");
  });

  it("a marca troca o destaque e deixa alerta, erro e sucesso com o sistema", () => {
    const tokens = Object.keys(coresDaMarca("#1e6fd9")!.claro.tokens);
    expect(tokens).toContain("--primary");
    expect(tokens).toContain("--gradient-primary");
    for (const doSistema of ["--destructive", "--warning", "--success", "--info", "--background", "--card"]) {
      expect(tokens).not.toContain(doSistema);
    }
  });

  it("a folha de estilo vence o tema pela especificidade, com o escuro por último", () => {
    const css = cssDaMarca(coresDaMarca("#1e6fd9")!);
    expect(css.startsWith("html:root{")).toBe(true);
    expect(css.indexOf("html.dark{")).toBeGreaterThan(css.indexOf("html:root{"));
    expect(css).not.toMatch(/[<>]/);
  });

  it("cor inválida não gera marca", () => {
    expect(coresDaMarca("vermelho")).toBeNull();
    expect(tomParaOTema(lerHex("#ffffff")!, "claro").ajustado).toBe(true);
  });
});

describe("entrada pela academia", () => {
  it("o link de entrada, a matrícula e o primeiro acesso dizem a academia", () => {
    expect(slugDeEntrada({ search: "", hash: "#/p/tiete-fitness/entrar" })).toBe("tiete-fitness");
    expect(slugDeEntrada({ search: "", hash: "#/p/tiete-fitness" })).toBe("tiete-fitness");
    expect(slugDeEntrada({ search: "", hash: "#/p/tiete-fitness/primeiro-acesso?x=1" })).toBe("tiete-fitness");
  });

  it("o app instalado diz a academia pelo endereço de início", () => {
    expect(slugDeEntrada({ search: "?academia=Tiete-Fitness", hash: "" })).toBe("tiete-fitness");
  });

  it("sem academia, ou com lixo, não há entrada", () => {
    expect(slugDeEntrada({ search: "", hash: "#/auth/login" })).toBeNull();
    expect(slugDeEntrada({ search: "?academia=<script>", hash: "" })).toBeNull();
    expect(slugDeEntrada({ search: "", hash: "#/p/a%2Fb" })).toBeNull();
    expect(slugDeEntrada({ search: "?academia=" + "a".repeat(81), hash: "" })).toBeNull();
  });

  it("o link de entrada que a academia divulga", () => {
    expect(linkDeEntrada("https://app.arkefit.com.br/", "tiete-fitness")).toBe("https://app.arkefit.com.br/#/p/tiete-fitness/entrar");
  });
});

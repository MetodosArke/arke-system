import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blocosMarkdown, imagemPermitida, MarkdownSimples } from "./markdownSimples";

const montar = (texto: string) =>
  render(
    <MemoryRouter>
      <MarkdownSimples texto={texto} />
    </MemoryRouter>,
  );

describe("blocosMarkdown", () => {
  it("imagem numa linha só vira figura com legenda", () => {
    expect(blocosMarkdown("![A fila do dia](/ajuda/telas/fila.jpg)")).toEqual([
      { tipo: "imagem", legenda: "A fila do dia", src: "/ajuda/telas/fila.jpg" },
    ]);
  });

  it("linhas de dica seguidas viram uma dica; linha em branco separa", () => {
    const blocos = blocosMarkdown("> primeira\n> continua\n\n> outra");
    expect(blocos).toEqual([
      { tipo: "dica", texto: "primeira continua" },
      { tipo: "dica", texto: "outra" },
    ]);
  });

  it("o que os documentos legais usam continua igual", () => {
    expect(blocosMarkdown("# Título\n\nTexto **forte**.\n\n- um\n- dois\n\n1. a\n2. b")).toEqual([
      { tipo: "h1", texto: "Título" },
      { tipo: "p", texto: "Texto **forte**." },
      { tipo: "ul", itens: ["um", "dois"] },
      { tipo: "ol", itens: ["a", "b"] },
    ]);
  });
});

describe("MarkdownSimples", () => {
  it("link interno vira link do app, https abre em outra aba, o resto é texto", () => {
    montar("Veja [a fila](/admin), [o Asaas](https://www.asaas.com) e [isto](javascript:alert(1)).");
    expect(screen.getByRole("link", { name: "a fila" })).toHaveAttribute("href", "/admin");
    const externo = screen.getByRole("link", { name: "o Asaas" });
    expect(externo).toHaveAttribute("target", "_blank");
    expect(externo).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "isto" })).not.toBeInTheDocument();
    expect(screen.getByText(/isto/)).toBeInTheDocument();
  });

  it("imagem fora da pasta da ajuda não é carregada", () => {
    montar("![rastreador](https://exemplo.com/pixel.png)");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("rastreador")).toBeInTheDocument();
  });

  it("HTML no texto aparece como texto", () => {
    montar("<img src=x onerror=alert(1)> **ok**");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });

  it("aceita só imagens da pasta pública da ajuda", () => {
    expect(imagemPermitida("/ajuda/telas/fila.jpg")).toBe(true);
    expect(imagemPermitida("/ajuda/../segredo.png")).toBe(false);
    expect(imagemPermitida("//exemplo.com/ajuda/x.png")).toBe(false);
  });
});

describe("bloco de código", () => {
  it("mantém o texto como está, sem interpretar", () => {
    expect(blocosMarkdown("Antes\n```\n{ \"a\": 1 }\n  - não é lista\n```\nDepois")).toEqual([
      { tipo: "p", texto: "Antes" },
      { tipo: "codigo", texto: '{ "a": 1 }\n  - não é lista' },
      { tipo: "p", texto: "Depois" },
    ]);
  });
});

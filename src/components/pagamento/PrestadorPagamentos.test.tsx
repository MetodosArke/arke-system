import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrestadorPagamentos } from "./PrestadorPagamentos";
import { SELO_ASAAS, TEXTO_PRESTADOR } from "@/lib/prestadorPagamentos";

describe("PrestadorPagamentos", () => {
  it("mostra o selo do Asaas (claro e escuro), o texto com a razão social e o CNPJ, e o atendimento do Asaas", () => {
    const { container } = render(<PrestadorPagamentos />);
    expect(screen.getByText(TEXTO_PRESTADOR)).toBeInTheDocument();
    const imagens = [...container.querySelectorAll("img")];
    expect(imagens.map((i) => i.getAttribute("src"))).toEqual([SELO_ASAAS.positivo, SELO_ASAAS.negativoBranco]);
    for (const img of imagens) {
      expect(img.getAttribute("width")).toBe("160");
      expect(img.getAttribute("height")).toBe("48");
      // O Asaas confere pelo Referer que o selo carregou.
      expect(img.hasAttribute("referrerpolicy")).toBe(false);
    }
    const link = screen.getByRole("link", { name: /Asaas \(abre em nova aba\)/ });
    expect(link).toHaveAttribute("href", "https://asaas.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "0800 009 0037" })).toHaveAttribute("href", "tel:08000090037");
    expect(screen.getByRole("link", { name: "contato@asaas.com.br" })).toHaveAttribute("href", "mailto:contato@asaas.com.br");
  });

  it("se a imagem não carrega, ela sai e o texto fica de pé sozinho", () => {
    const { container } = render(<PrestadorPagamentos />);
    for (const img of [...container.querySelectorAll("img")]) fireEvent.error(img);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Asaas \(abre em nova aba\)/ })).toBeNull();
    expect(screen.getByText(TEXTO_PRESTADOR)).toBeInTheDocument();
  });

  it("sem o bloco do atendimento quando a tela já o mostra", () => {
    render(<PrestadorPagamentos atendimento={false} />);
    expect(screen.queryByText(/0800 009 0037/)).toBeNull();
    expect(screen.getByText(TEXTO_PRESTADOR)).toBeInTheDocument();
  });
});

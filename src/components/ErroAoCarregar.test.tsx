import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErroAoCarregar } from "./ErroAoCarregar";

describe("ErroAoCarregar", () => {
  it("diz o que não carregou, avisa que nada foi apagado e tenta de novo", () => {
    const tentar = vi.fn();
    render(<ErroAoCarregar oQue="os alunos" onTentarDeNovo={tentar} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os alunos.");
    expect(screen.getByRole("alert")).toHaveTextContent("Nada foi apagado");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(tentar).toHaveBeenCalledTimes(1);
  });

  it("enquanto tenta, o botão espera", () => {
    render(<ErroAoCarregar oQue="o treino" onTentarDeNovo={() => undefined} tentando />);
    expect(screen.getByRole("button", { name: "Tentando..." })).toBeDisabled();
  });
});

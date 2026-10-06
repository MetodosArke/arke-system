import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AvaliarAtendimento, PERGUNTA_AVALIACAO } from "./AvaliarAtendimento";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const montar = (aoAvaliar = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AvaliarAtendimento chamadoId="ch-1" aoAvaliar={aoAvaliar} />
    </QueryClientProvider>,
  );
  return aoAvaliar;
};

describe("AvaliarAtendimento", () => {
  beforeEach(() => rpc.mockReset());

  it("pergunta como foi, de 1 a 5, com o comentário opcional, e grava pela função do banco", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const aoAvaliar = montar();
    expect(screen.getByText(PERGUNTA_AVALIACAO)).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "Enviar avaliação" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "4 de 5" }));
    fireEvent.change(screen.getByLabelText("Comentário (opcional)"), { target: { value: "  Resolveram rápido.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    await waitFor(() => expect(aoAvaliar).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("avaliar_atendimento", { _chamado_id: "ch-1", _nota: 4, _comentario: "Resolveram rápido." });
  });

  it("a recusa do banco aparece na tela", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Este atendimento já foi avaliado." } });
    const aoAvaliar = montar();
    fireEvent.click(screen.getByRole("radio", { name: "5 de 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este atendimento já foi avaliado.");
    expect(aoAvaliar).not.toHaveBeenCalled();
  });
});

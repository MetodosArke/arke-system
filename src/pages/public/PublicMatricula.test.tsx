import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicMatricula from "./PublicMatricula";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signIn: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/p/tiete-fitness"]}>
        <Routes>
          <Route path="/p/:slug" element={<PublicMatricula />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => rpc.mockReset());

describe("PublicMatricula", () => {
  it("academia que não existe: diz que não foi encontrada", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    montar();
    expect(await screen.findByText(/academia não encontrada/i)).toBeInTheDocument();
  });

  it("falha de rede não se passa por academia inexistente", async () => {
    // Antes as duas caíam na mesma tela: quem tinha o link certo lia que a
    // academia não existe por causa de um soluço de conexão.
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    montar();
    expect(await screen.findByText(/não foi possível carregar a matrícula/i)).toBeInTheDocument();
    expect(screen.queryByText(/academia não encontrada/i)).not.toBeInTheDocument();
  });

  it("tentar de novo recupera quando a conexão volta", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } })
      .mockResolvedValue({ data: [{ organization_id: "o1", nome: "Tietê Fitness", planos: [] }], error: null });
    montar();

    fireEvent.click(await screen.findByRole("button", { name: /tentar de novo/i }));
    await waitFor(() => expect(screen.getAllByText(/tietê fitness/i).length).toBeGreaterThan(0));
  });
});

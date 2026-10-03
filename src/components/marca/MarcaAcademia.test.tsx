import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ organization: null, organizationRole: null, isLoading: false, isAuthenticated: false, rolesLoaded: true }),
}));

import { MarcaAcademiaProvider } from "./MarcaAcademia";

function montar(rota: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[rota]}>
        <MarcaAcademiaProvider>
          <p>tela</p>
        </MarcaAcademiaProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const href = () => document.querySelector('link[rel="manifest"]')?.getAttribute("href");

describe("marca da academia no documento", () => {
  beforeEach(() => {
    rpc.mockReset();
    document.head.innerHTML = '<link rel="manifest" href="/manifest/horizonte">';
    document.title = "ArkeFit";
  });

  // main.tsx já apontou o manifesto da academia. Voltar ao da ArkeFit enquanto
  // a marca carrega fazia o navegador às vezes ficar com o do meio.
  it("enquanto a marca carrega, o manifesto da academia fica", async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    montar("/p/horizonte/entrar");
    await new Promise((r) => setTimeout(r, 50));
    expect(href()).toBe("/manifest/horizonte");
    expect(document.getElementById("marca-academia")).toBeNull();
  });

  it("com a marca carregada: cor, título e manifesto da academia", async () => {
    rpc.mockResolvedValue({
      data: { nome: "Academia Horizonte", slug: "horizonte", logo_url: null, cor_marca: "#1e6fd9", icone_192: null, icone_512: null },
      error: null,
    });
    montar("/p/horizonte/entrar");
    await waitFor(() => expect(document.getElementById("marca-academia")).not.toBeNull());
    expect(href()).toBe("/manifest/horizonte");
    expect(document.title).toBe("Academia Horizonte");
  });

  it("academia que não existe volta a ser a ArkeFit", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    montar("/p/nao-existe/entrar");
    await waitFor(() => expect(href()).toBe("/manifest.json"));
    expect(document.getElementById("marca-academia")).toBeNull();
  });
});

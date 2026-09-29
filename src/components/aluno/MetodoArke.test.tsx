import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MetodoArke } from "./MetodoArke";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const montar = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("anúncio do Método ARKE", () => {
  beforeEach(() => rpc.mockReset());

  // Sem preço no app (decisão comercial de 28/09/2026): o valor fica com a recepção.
  it("academia que vende: mostra os níveis sem preço e manda à recepção", async () => {
    rpc.mockResolvedValue({ data: [{ nivel: "integrado", valor_varejo: 119 }, { nivel: "elite", valor_varejo: 199 }], error: null });
    montar(<MetodoArke organizationId="o1" />);
    expect(await screen.findByText("Método ARKE na sua academia")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Disponível nos níveis Integrado e Elite");
    expect(document.body.textContent).toContain("fale com a recepção para conhecer");
    expect(document.body.textContent).not.toMatch(/R\$|119|199/);
    expect(document.body.textContent).not.toMatch(/breve/i);
  });

  it("academia que não vende: não anuncia nada", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { container } = montar(<MetodoArke organizationId="o1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("no recurso do Método: oferece se vende, e só diz que não está no plano se não vende", async () => {
    rpc.mockResolvedValue({ data: [{ nivel: "integrado", valor_varejo: 119 }], error: null });
    montar(<MetodoArke organizationId="o1" recurso="O chat com a nutricionista" />);
    expect(await screen.findByText("Faz parte do Método ARKE")).toBeInTheDocument();
    expect(document.body.textContent).toContain("disponível na sua academia");
    expect(document.body.textContent).not.toMatch(/R\$|119/);

    rpc.mockResolvedValue({ data: [], error: null });
    montar(<MetodoArke organizationId="o2" recurso="O chat com a nutricionista" />);
    expect(await screen.findByText("O chat com a nutricionista não está disponível no seu plano.")).toBeInTheDocument();
  });
});

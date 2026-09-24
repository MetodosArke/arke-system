import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MinhasMensalidades, prazo, type Mensalidade } from "./MinhasMensalidades";

const linhas = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: linhas(), error: null }) }) }) }),
    }),
  },
}));
vi.mock("@/lib/dataBrasilia", () => ({ hojeBrasilia: () => "2026-09-24" }));

const m = (x: Partial<Mensalidade>): Mensalidade => ({
  id: x.id ?? "m1",
  vencimento: "2026-09-24",
  valor: 129.9,
  status: "pendente",
  invoice_url: "https://www.asaas.com/i/abc",
  data_pagamento: null,
  ...x,
});

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MinhasMensalidades alunoId="aluno-1" />
    </QueryClientProvider>,
  );

describe("MinhasMensalidades", () => {
  beforeEach(() => linhas.mockReset());

  it("não aparece para quem não tem mensalidade cobrada pelo ARKE", async () => {
    linhas.mockReturnValue([]);
    const { container } = montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra a mensalidade em aberto com o link da fatura e as últimas pagas", async () => {
    linhas.mockReturnValue([
      m({ id: "a", vencimento: "2026-09-24" }),
      m({ id: "b", vencimento: "2026-08-24", status: "confirmado", invoice_url: null }),
      m({ id: "c", vencimento: "2026-07-24", status: "cancelado" }),
    ]);
    montar();
    await waitFor(() => expect(screen.getByText("Vence hoje")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Pagar/ })).toHaveAttribute("href", "https://www.asaas.com/i/abc");
    expect(screen.getByText("Paga")).toBeInTheDocument();
    // Cancelada não é dívida nem pagamento: não aparece.
    expect(document.body.textContent).not.toContain("24/07/2026");
  });

  it("diz quando não há nada em aberto", async () => {
    linhas.mockReturnValue([m({ status: "confirmado" })]);
    montar();
    await waitFor(() => expect(screen.getByText("Nenhuma mensalidade em aberto.")).toBeInTheDocument());
  });
});

describe("prazo", () => {
  it("fala em vencimento futuro, de hoje e passado", () => {
    expect(prazo({ vencimento: "2026-10-01", status: "pendente" }, "2026-09-24")).toBe("Vence em 01/10/2026");
    expect(prazo({ vencimento: "2026-09-24", status: "pendente" }, "2026-09-24")).toBe("Vence hoje");
    // Pendente com data passada é o webhook de atraso que ainda não chegou.
    expect(prazo({ vencimento: "2026-09-20", status: "pendente" }, "2026-09-24")).toBe("Venceu em 20/09/2026");
    expect(prazo({ vencimento: "2026-09-24", status: "atrasado" }, "2026-09-24")).toBe("Venceu em 24/09/2026");
  });
});

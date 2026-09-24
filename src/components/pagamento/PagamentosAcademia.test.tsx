import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PagamentosAcademia, prazo } from "./PagamentosAcademia";

type Linha = { id: string; vencimento: string; valor: number; status: string; invoice_url: string | null; descricao?: string };
const tabelas: Record<string, Linha[]> = { mensalidades: [], cobrancas_avulsas: [] };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: tabelas[tabela], error: null }) }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/dataBrasilia", () => ({ hojeBrasilia: () => "2026-09-24" }));

const linha = (x: Partial<Linha>): Linha => ({
  id: x.id ?? "m1",
  vencimento: "2026-09-24",
  valor: 129.9,
  status: "pendente",
  invoice_url: "https://www.asaas.com/i/abc",
  ...x,
});

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PagamentosAcademia alunoId="aluno-1" />
    </QueryClientProvider>,
  );

describe("PagamentosAcademia", () => {
  beforeEach(() => {
    tabelas.mensalidades = [];
    tabelas.cobrancas_avulsas = [];
  });

  it("não aparece para quem não tem nada cobrado pelo ARKE", async () => {
    const { container } = montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra mensalidade e cobrança avulsa em aberto, cada uma com o link da fatura", async () => {
    tabelas.mensalidades = [
      linha({ id: "a", vencimento: "2026-09-24" }),
      linha({ id: "b", vencimento: "2026-08-24", status: "confirmado", invoice_url: null }),
      linha({ id: "c", vencimento: "2026-07-24", status: "cancelado" }),
    ];
    tabelas.cobrancas_avulsas = [
      linha({ id: "d", descricao: "Taxa de matrícula", valor: 80, vencimento: "2026-09-20", invoice_url: "https://www.asaas.com/i/taxa" }),
    ];
    montar();
    await waitFor(() => expect(screen.getByText("Vence hoje")).toBeInTheDocument());
    const links = screen.getAllByRole("link", { name: /Pagar/ }).map((l) => l.getAttribute("href"));
    // A vencida primeiro: é a que o aluno precisa resolver antes.
    expect(links).toEqual(["https://www.asaas.com/i/taxa", "https://www.asaas.com/i/abc"]);
    expect(screen.getByText("Venceu em 20/09/2026")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Taxa de matrícula");
    expect(screen.getByText("Paga")).toBeInTheDocument();
    // Cancelada não é dívida nem pagamento: não aparece.
    expect(document.body.textContent).not.toContain("24/07/2026");
  });

  it("diz quando não há nada em aberto", async () => {
    tabelas.mensalidades = [linha({ status: "confirmado" })];
    montar();
    await waitFor(() => expect(screen.getByText("Nada em aberto.")).toBeInTheDocument());
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

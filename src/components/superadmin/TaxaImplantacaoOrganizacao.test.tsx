import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaxaImplantacaoOrganizacao } from "./TaxaImplantacaoOrganizacao";

let taxa: Record<string, unknown> | null = null;
let parcelas: Record<string, unknown>[] = [];
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        ilike: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: parcelas, error: null }),
        maybeSingle: () =>
          Promise.resolve({ data: tabela === "taxas_implantacao" ? taxa : { valor: 1490 }, error: null }),
      };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/dataBrasilia", () => ({ hojeBrasilia: () => "2026-09-24" }));

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TaxaImplantacaoOrganizacao organizationId="org-1" />
    </QueryClientProvider>,
  );

describe("TaxaImplantacaoOrganizacao", () => {
  beforeEach(() => {
    taxa = null;
    parcelas = [];
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { adotada: false, parcelas: [{}, {}, {}] }, error: null });
  });

  it("vem com o valor de referência e emite com o parcelamento escolhido", async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText("Valor (R$)")).toHaveValue("1490"));
    fireEvent.click(screen.getByRole("button", { name: "Emitir taxa de implantação" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("asaas-taxa-implantacao", {
        body: { organization_id: "org-1", valor: 1490, parcelas: 1, primeiro_vencimento: "2026-09-24" },
      }),
    );
  });

  it("valor que não dá R$ 5 por parcela não emite", async () => {
    montar();
    const campo = await screen.findByLabelText("Valor (R$)");
    fireEvent.change(campo, { target: { value: "4" } });
    expect(screen.getByRole("button", { name: "Emitir taxa de implantação" })).toBeDisabled();
    expect(screen.getByText(/pelo menos R\$ 5,00/)).toBeInTheDocument();
  });

  it("apagar o valor para digitar outro não traz a referência de volta", async () => {
    montar();
    const campo = await screen.findByLabelText("Valor (R$)");
    await waitFor(() => expect(campo).toHaveValue("1490"));
    fireEvent.change(campo, { target: { value: "" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(campo).toHaveValue("");
  });

  it("taxa já emitida mostra as parcelas, sem oferecer emitir de novo", async () => {
    taxa = { valor_total: 1490, parcelas: 3, created_at: "2026-09-24T12:00:00Z" };
    parcelas = [
      { id: "a", valor: 496.66, vencimento: "2026-09-24", status: "confirmado", invoice_url: "https://asaas/i/a", descricao: "Parcela 1 de 3" },
      { id: "b", valor: 496.66, vencimento: "2026-10-24", status: "pendente", invoice_url: null, descricao: "Parcela 2 de 3" },
    ];
    montar();
    expect(await screen.findByText("Paga")).toBeInTheDocument();
    expect(screen.getByText("Em aberto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Emitir/ })).not.toBeInTheDocument();
  });

  it("taxa emitida com parcela fora do registro oferece completar, sem emitir outra", async () => {
    taxa = { valor_total: 1490, parcelas: 3, created_at: "2026-09-24T12:00:00Z" };
    parcelas = [
      { id: "a", valor: 496.66, vencimento: "2026-09-24", status: "pendente", invoice_url: null, descricao: "Parcela 1 de 3" },
    ];
    invoke.mockResolvedValue({ data: { completada: 2 }, error: null });
    montar();
    expect(await screen.findByText(/2 parcela\(s\) emitida\(s\) no Asaas não estão registradas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Registrar as parcelas que faltam" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("asaas-taxa-implantacao", { body: { organization_id: "org-1", completar: true } }),
    );
    expect(screen.queryByRole("button", { name: /Emitir/ })).not.toBeInTheDocument();
  });

  it("com todas as parcelas registradas, não oferece completar", async () => {
    taxa = { valor_total: 990, parcelas: 1, created_at: "2026-09-24T12:00:00Z" };
    parcelas = [{ id: "a", valor: 990, vencimento: "2026-09-24", status: "pendente", invoice_url: null, descricao: "Taxa de implantação ARKE" }];
    montar();
    expect(await screen.findByText("Em aberto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Registrar as parcelas/ })).not.toBeInTheDocument();
  });
});

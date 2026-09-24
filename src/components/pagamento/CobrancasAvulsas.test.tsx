import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CobrancasAvulsas } from "./CobrancasAvulsas";

const linhas = vi.fn();
const invoke = vi.fn();
let papel: string | null = "gestor";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: linhas(), error: null }) }) }) }),
    }),
    rpc: () => Promise.resolve({ data: [{ percentual: 2.99, fixa: 0.49 }], error: null }),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ organizationRole: papel }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/dataBrasilia", () => ({ hojeBrasilia: () => "2026-09-24" }));

const cobranca = (x: Record<string, unknown>) => ({
  id: "c1",
  tipo: "taxa_matricula",
  descricao: "Taxa de matrícula",
  valor: 80,
  vencimento: "2026-09-24",
  status: "pendente",
  invoice_url: "https://www.asaas.com/i/abc",
  asaas_payment_id: "pay_1",
  data_pagamento: null,
  created_at: "2026-09-24T10:00:00Z",
  ...x,
});

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CobrancasAvulsas alunoId="aluno-1" />
    </QueryClientProvider>,
  );

describe("CobrancasAvulsas", () => {
  beforeEach(() => {
    linhas.mockReset();
    invoke.mockReset();
    papel = "gestor";
  });

  it("mostra a cobrança com a situação e o link da fatura", async () => {
    linhas.mockReturnValue([cobranca({})]);
    montar();
    await waitFor(() => expect(screen.getByText("Vence hoje")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Abrir fatura/ })).toHaveAttribute("href", "https://www.asaas.com/i/abc");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("oferece tentar de novo só para a emissão não confirmada", async () => {
    linhas.mockReturnValue([cobranca({ asaas_payment_id: null, invoice_url: null })]);
    montar();
    await waitFor(() => expect(screen.getByText("Emissão não confirmada")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("asaas-cobranca-avulsa", { body: { acao: "reemitir", cobranca_id: "c1" } }),
    );
  });

  it("professor vê a lista, mas não emite nem cancela", async () => {
    // A mesma regra do servidor, que confere de novo: gestão e recepção.
    papel = "professor";
    linhas.mockReturnValue([cobranca({})]);
    montar();
    await waitFor(() => expect(screen.getByText("Taxa de matrícula")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Nova cobrança/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("mostra quanto a academia recebe antes de emitir, e manda o valor lido do jeito brasileiro", async () => {
    linhas.mockReturnValue([]);
    invoke.mockResolvedValue({ data: { cobranca_id: "c2", invoice_url: "https://x" }, error: null });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Nova cobrança/ }));
    fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "80,00" } });
    // 2,99% de 80 = 2,39 + 0,49 = 2,88 de taxa.
    await waitFor(() => expect(document.body.textContent).toContain("a academia recebe R$"));
    expect(document.body.textContent?.replace(/\u00a0/g, " ")).toContain("a academia recebe R$ 77,12");
    fireEvent.click(screen.getByRole("button", { name: "Emitir cobrança" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("asaas-cobranca-avulsa", {
        body: { acao: "criar", aluno_id: "aluno-1", tipo: "taxa_matricula", descricao: undefined, valor: 80, vencimento: undefined },
      }),
    );
  });
});

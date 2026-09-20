import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizacaoBillingGate } from "./OrganizacaoBillingGate";

const rpc = vi.fn();
const signOut = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ rolesLoaded: true, signOut }),
}));

const BLOQUEIO_BASE = {
  organization_id: "org-1",
  organizacao_nome: "Tietê Fitness",
  bloqueada: true,
  cobrancas_vencidas: 1,
  valor_em_aberto: 5,
  vencimento_mais_antigo: "2026-09-18",
  invoice_url: "https://asaas.test/fatura/1",
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrganizacaoBillingGate>
        <div>painel da academia</div>
      </OrganizacaoBillingGate>
    </QueryClientProvider>
  );
};

describe("OrganizacaoBillingGate", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("bloqueia a equipe quando há cobrança vencida", async () => {
    rpc.mockResolvedValue({ data: [BLOQUEIO_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    expect(screen.queryByText("painel da academia")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Tietê Fitness");
    // Valor e vencimento precisam aparecer: sem eles o gestor não sabe o que
    // pagar nem consegue conferir se é a cobrança que ele acha que é.
    // O Intl separa "R$" do número com espaço não-quebrável (U+00A0), não
    // com espaço comum — daí o escape em vez do caractere literal.
    expect(document.body.textContent).toContain("R$\u00A05,00");
    expect(document.body.textContent).toContain("18/09/2026");
  });

  it("deixa claro que os alunos continuam acessando", async () => {
    rpc.mockResolvedValue({ data: [BLOQUEIO_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    // O gestor precisa saber que a academia não parou — senão liga para o
    // suporte achando que os alunos ficaram sem treino.
    expect(document.body.textContent).toContain("alunos seguem com acesso normal");
  });

  it("libera o painel quando a organização está em dia", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, bloqueada: false, cobrancas_vencidas: 0 }], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia")).toBeInTheDocument());
    expect(screen.queryByText("Acesso suspenso")).not.toBeInTheDocument();
  });

  it("libera quem é isento — a RPC não devolve linha nenhuma", async () => {
    // Super Admin, Admin ARKE e quem não é equipe de academia nenhuma.
    rpc.mockResolvedValue({ data: [], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia")).toBeInTheDocument());
  });

  it("orienta a falar com o suporte quando não há link de fatura", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, invoice_url: null }], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    expect(document.body.textContent).toContain("Entre em contato com o suporte ArkeFit");
    expect(screen.queryByText("Regularizar pagamento")).not.toBeInTheDocument();
  });

  it("pluraliza a contagem de cobranças vencidas", async () => {
    rpc.mockResolvedValue({
      data: [{ ...BLOQUEIO_BASE, cobrancas_vencidas: 3, valor_em_aberto: 1185 }],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(document.body.textContent).toContain("3 cobranças vencidas"));
    expect(document.body.textContent).toContain("R$\u00A01.185,00");
  });
});

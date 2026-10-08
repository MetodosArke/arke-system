import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizacaoBillingGate } from "./OrganizacaoBillingGate";
import { useModoEssencial } from "@/contexts/ModoEssencialContext";

const rpc = vi.fn();
const signOut = vi.fn();
const auth = { rolesLoaded: true, signOut, user: { id: "pessoa-1" }, organization: { id: "org-1" } as { id: string } | null };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => auth,
}));

const BLOQUEIO_BASE = {
  organization_id: "org-1",
  organizacao_nome: "Tietê Fitness",
  bloqueada: true,
  cobrancas_vencidas: 1,
  valor_em_aberto: 5,
  vencimento_mais_antigo: "2026-09-18",
  invoice_url: "https://asaas.test/fatura/1",
  modo: "bloqueio",
};

/** A linha da recepção da academia bloqueada: sem bloqueio, sem número e sem fatura (20261420010000). */
const RECEPCAO_BLOQUEADA = {
  ...BLOQUEIO_BASE,
  bloqueada: false,
  cobrancas_vencidas: 0,
  valor_em_aberto: 0,
  vencimento_mais_antigo: null,
  invoice_url: null,
  modo: "essencial",
};

/** O que as páginas do painel leem do gate. */
function Painel() {
  return <div>painel da academia{useModoEssencial() ? " (modo essencial)" : ""}</div>;
}

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrganizacaoBillingGate>
        <Painel />
      </OrganizacaoBillingGate>
    </QueryClientProvider>
  );
};

describe("OrganizacaoBillingGate", () => {
  beforeEach(() => {
    rpc.mockReset();
    auth.organization = { id: "org-1" };
  });

  // ── Os três caminhos: a tela de suspensão, o modo essencial e o painel ──

  it("gestor, professor e nutricionista da academia bloqueada: a tela de suspensão", async () => {
    rpc.mockResolvedValue({ data: [BLOQUEIO_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    expect(screen.queryByText(/painel da academia/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Regularizar pagamento/ })).toHaveAttribute("href", "https://asaas.test/fatura/1");
  });

  it("a recepção da academia bloqueada: o painel em modo essencial, sem valor e sem fatura", async () => {
    rpc.mockResolvedValue({ data: [RECEPCAO_BLOQUEADA], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia (modo essencial)")).toBeInTheDocument());
    expect(screen.queryByText("Acesso suspenso")).not.toBeInTheDocument();
    // Quem paga é o gestor: nada de valor, de link da fatura nem da faixa da tolerância.
    expect(document.body.textContent).not.toMatch(/R\$|Pagar agora|Regularizar/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("a academia em dia: o painel de sempre, sem modo essencial", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, bloqueada: false, cobrancas_vencidas: 0, modo: "normal" }], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia")).toBeInTheDocument());
    expect(screen.queryByText("Acesso suspenso")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // ── Quem tem vínculo em mais de uma academia ──

  it("o modo essencial vale só na academia ativa", async () => {
    // Recepção da org-2 (bloqueada) e gestora da org-1 (em dia), trabalhando na org-1.
    rpc.mockResolvedValue({
      data: [{ ...RECEPCAO_BLOQUEADA, organization_id: "org-2" }, { ...BLOQUEIO_BASE, bloqueada: false, cobrancas_vencidas: 0, modo: "normal" }],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia")).toBeInTheDocument());
  });

  it("a bloqueada manda: gestor de outra academia bloqueada cai na suspensão mesmo onde é recepção", async () => {
    rpc.mockResolvedValue({
      data: [{ ...BLOQUEIO_BASE, organization_id: "org-2", organizacao_nome: "Outra Unidade" }, RECEPCAO_BLOQUEADA],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    expect(document.body.textContent).toContain("Outra Unidade");
  });

  it("a resposta sem modo (a função de antes) deixa a recepção no painel de sempre", async () => {
    const { modo: _semModo, ...semModo } = RECEPCAO_BLOQUEADA;
    rpc.mockResolvedValue({ data: [semModo], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("painel da academia")).toBeInTheDocument());
  });

  it("na tolerância, a equipe vê a faixa com o prazo e o link da fatura", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, bloqueada: false, modo: "normal" }], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Mensalidade do ARKE em aberto"));
    expect(screen.getByText("painel da academia")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pagar agora" })).toHaveAttribute("href", "https://asaas.test/fatura/1");
  });

  // ── A tela de suspensão ──

  it("bloqueia a equipe quando há cobrança vencida", async () => {
    rpc.mockResolvedValue({ data: [BLOQUEIO_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Acesso suspenso")).toBeInTheDocument());
    expect(screen.queryByText(/painel da academia/)).not.toBeInTheDocument();
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
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, bloqueada: false, cobrancas_vencidas: 0, modo: "normal" }], error: null });

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

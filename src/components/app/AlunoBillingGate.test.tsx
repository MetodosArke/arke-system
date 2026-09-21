import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlunoBillingGate } from "./AlunoBillingGate";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ alunoId: "aluno-1", rolesLoaded: true }),
}));

const BLOQUEIO_BASE = {
  aluno_id: "aluno-1",
  bloqueado: true,
  assinatura_status: "ativa",
  cobrancas_vencidas: 1,
  valor_em_aberto: 39.9,
  vencimento_mais_antigo: "2026-09-11",
  invoice_url: "https://asaas.com/i/abc",
};

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AlunoBillingGate>
        <div>conteudo do app</div>
      </AlunoBillingGate>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  rpc.mockReset();
});

describe("AlunoBillingGate", () => {
  it("bloqueia quando o webhook se perdeu e a cobrança venceu sem confirmação", async () => {
    // O caso que motivou a rede de segurança: a assinatura continua `ativa`
    // porque nenhum PAYMENT_OVERDUE chegou, mas existe cobrança vencida sem
    // confirmação. Antes disto o aluno treinaria de graça indefinidamente.
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, assinatura_status: "ativa" }], error: null });
    montar();

    expect(await screen.findByText("Pagamento pendente")).toBeInTheDocument();
    expect(screen.queryByText("conteudo do app")).not.toBeInTheDocument();
  });

  it("bloqueia pelo caminho antigo, quando o webhook chegou e marcou atrasada", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, assinatura_status: "atrasada" }], error: null });
    montar();

    expect(await screen.findByText("Pagamento pendente")).toBeInTheDocument();
  });

  it("passa o aluno já resolvido pelo AuthContext para a RPC", async () => {
    // Uma pessoa pode ser aluna de duas academias. Deixar o banco escolher
    // por user_id reencenaria a armadilha do vínculo duplo.
    rpc.mockResolvedValue({ data: [], error: null });
    montar();

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("get_bloqueio_aluno", { _aluno_id: "aluno-1" });
  });

  it("libera o app quando não há bloqueio", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, bloqueado: false }], error: null });
    montar();

    expect(await screen.findByText("conteudo do app")).toBeInTheDocument();
    expect(screen.queryByText("Pagamento pendente")).not.toBeInTheDocument();
  });

  it("libera o app quando a RPC não devolve linha (ArkeFit, ou aluno sem assinatura)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    montar();

    expect(await screen.findByText("conteudo do app")).toBeInTheDocument();
  });

  it("oferece o link da fatura quando existe", async () => {
    rpc.mockResolvedValue({ data: [BLOQUEIO_BASE], error: null });
    montar();

    const link = await screen.findByRole("link", { name: /ir para pagamento/i });
    expect(link).toHaveAttribute("href", "https://asaas.com/i/abc");
  });

  it("sem link de fatura, manda falar com a academia em vez de deixar o aluno sem saída", async () => {
    rpc.mockResolvedValue({ data: [{ ...BLOQUEIO_BASE, invoice_url: null }], error: null });
    montar();

    expect(await screen.findByText(/fale com a sua academia/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ir para pagamento/i })).not.toBeInTheDocument();
  });
});

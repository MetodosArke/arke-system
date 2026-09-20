import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperAdminWebhooks from "./SuperAdminWebhooks";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const EVENTO_BASE = {
  id: "e1",
  created_at: "2026-09-20T10:00:00Z",
  processed_at: "2026-09-20T10:00:01Z",
  tipo_evento: "PAYMENT_CONFIRMED",
  asaas_event_id: "evt_1",
  asaas_payment_id: "pay_1",
  processado: true,
  resultado: "cobranca_b2b_atualizada",
  erro: null,
  situacao: "ok",
  payload: {},
};

const RESUMO_BASE = {
  total: 3,
  ultimas_24h: 3,
  erros: 0,
  pendentes: 0,
  sem_efeito: 0,
  primeiro_evento_em: "2026-09-20T09:00:00Z",
  ultimo_evento_em: "2026-09-20T10:00:00Z",
  horas_desde_ultimo: 0.5,
};

const mockarRpc = (eventos: unknown[], resumo: unknown) => {
  rpc.mockImplementation((nome: string) => {
    if (nome === "get_superadmin_webhooks_asaas") return Promise.resolve({ data: eventos, error: null });
    if (nome === "get_superadmin_webhooks_asaas_resumo")
      return Promise.resolve({ data: resumo === null ? [] : [resumo], error: null });
    return Promise.resolve({ data: null, error: new Error(`RPC inesperada: ${nome}`) });
  });
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminWebhooks />
    </QueryClientProvider>
  );
};

describe("SuperAdminWebhooks", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("separa evento que teve efeito de evento que não casou com nada", async () => {
    mockarRpc(
      [
        EVENTO_BASE,
        {
          ...EVENTO_BASE,
          id: "e2",
          asaas_payment_id: "pay_2",
          resultado: "sem_correspondencia",
          situacao: "sem_efeito",
        },
      ],
      { ...RESUMO_BASE, total: 2, ultimas_24h: 2, sem_efeito: 1 }
    );

    renderizar();

    await waitFor(() => expect(screen.getByText("Aplicado")).toBeInTheDocument());
    // "Sem efeito" aparece duas vezes de propósito: no contador do resumo e
    // na linha do evento. Conferir as duas garante que o número do topo não
    // ficou desacoplado da lista.
    expect(screen.getAllByText("Sem efeito")).toHaveLength(2);
    // O painel existe justamente porque "processado" não distinguia os dois;
    // a linha precisa dizer o que aconteceu, não só que terminou.
    expect(screen.getByText("Nenhuma cobrança correspondente no banco")).toBeInTheDocument();
    // E precisa dizer o que investigar — senão o operador não sabe agir.
    expect(document.body.textContent).toContain("apontando para outro ambiente do Asaas");
  });

  it("explica as duas causas possíveis quando nenhum evento chegou", async () => {
    mockarRpc([], { ...RESUMO_BASE, total: 0, ultimas_24h: 0, ultimo_evento_em: null, horas_desde_ultimo: null });

    renderizar();

    await waitFor(() => expect(document.body.textContent).toContain("Nenhum evento recebido até agora"));
    expect(document.body.textContent).toContain("ASAAS_WEBHOOK_SECRET");
    expect(screen.getByText("Nenhum evento registrado ainda.")).toBeInTheDocument();
  });

  it("mostra a mensagem de erro do evento que falhou", async () => {
    mockarRpc(
      [{ ...EVENTO_BASE, situacao: "erro", resultado: null, erro: "violates foreign key constraint" }],
      { ...RESUMO_BASE, total: 1, ultimas_24h: 1, erros: 1 }
    );

    renderizar();

    await waitFor(() => expect(screen.getByText("Erro")).toBeInTheDocument());
    expect(screen.getByText("violates foreign key constraint")).toBeInTheDocument();
  });

  it("filtra a lista por situação", async () => {
    mockarRpc(
      [
        EVENTO_BASE,
        { ...EVENTO_BASE, id: "e2", tipo_evento: "PAYMENT_OVERDUE", situacao: "sem_efeito", resultado: "sem_correspondencia" },
      ],
      { ...RESUMO_BASE, total: 2, ultimas_24h: 2, sem_efeito: 1 }
    );

    renderizar();

    await waitFor(() => expect(screen.getByText("PAYMENT_OVERDUE")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Buscar por tipo/), {
      target: { value: "PAYMENT_CONFIRMED" },
    });

    expect(screen.queryByText("PAYMENT_OVERDUE")).not.toBeInTheDocument();
    expect(screen.getByText("PAYMENT_CONFIRMED")).toBeInTheDocument();
  });

  it("exibe o erro quando a RPC é negada para quem não é superadmin", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Acesso restrito ao Super Admin ArkeFit.") });

    renderizar();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Acesso restrito ao Super Admin ArkeFit.")
    );
  });
});

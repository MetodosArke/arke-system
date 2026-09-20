import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FunilConversaoCard } from "./FunilConversaoCard";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const SAFRA_VAZIA = {
  safra: "2026-08-01",
  total_entradas: 0,
  em_trial: 0,
  ativos: 0,
  inadimplentes: 0,
  suspensos: 0,
  cancelados: 0,
  taxa_conversao_pct: 0,
  taxa_churn_pct: 0,
};

const SINAIS_ZERADOS = {
  trials_total: 0,
  trials_sem_prazo: 0,
  trials_vencidos: 0,
  inadimplentes: 0,
  suspensos: 0,
  transicoes_30d: 0,
};

/** Responde cada RPC pelo nome, já que o card faz duas chamadas distintas. */
const mockarRpc = (funil: unknown[], sinais: unknown) => {
  rpc.mockImplementation((nome: string) => {
    if (nome === "get_superadmin_funil_conversao") return Promise.resolve({ data: funil, error: null });
    if (nome === "get_superadmin_funil_sinais") return Promise.resolve({ data: [sinais], error: null });
    return Promise.resolve({ data: null, error: new Error(`RPC inesperada: ${nome}`) });
  });
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FunilConversaoCard />
    </QueryClientProvider>
  );
};

describe("FunilConversaoCard", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("acumula as safras do período para calcular conversão e churn", async () => {
    mockarRpc(
      [
        {
          safra: "2026-08-01",
          total_entradas: 6,
          em_trial: 1,
          ativos: 3,
          inadimplentes: 0,
          suspensos: 0,
          cancelados: 2,
          taxa_conversao_pct: 50,
          taxa_churn_pct: 33.3,
        },
        {
          safra: "2026-09-01",
          total_entradas: 4,
          em_trial: 2,
          ativos: 2,
          inadimplentes: 0,
          suspensos: 0,
          cancelados: 0,
          taxa_conversao_pct: 50,
          taxa_churn_pct: 0,
        },
      ],
      SINAIS_ZERADOS
    );

    renderizar();

    await waitFor(() => expect(screen.getByText("Entradas no período")).toBeInTheDocument());

    // 10 entradas, 5 ativos => 50% de conversão; 2 cancelados => 20% de churn.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("20.0%")).toBeInTheDocument();
  });

  it("não divide por zero quando o período não teve nenhuma entrada", async () => {
    mockarRpc([SAFRA_VAZIA], SINAIS_ZERADOS);

    renderizar();

    await waitFor(() => expect(screen.getByText("Conversão para ativo")).toBeInTheDocument());

    // Sem entradas, as taxas têm que ficar em 0.0% e não virar NaN.
    expect(screen.getAllByText("0.0%")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("destaca trials sem prazo com a orientação do que fazer", async () => {
    mockarRpc([SAFRA_VAZIA], { ...SINAIS_ZERADOS, trials_total: 2, trials_sem_prazo: 2 });

    renderizar();

    await waitFor(() => expect(screen.getByText("Trials sem prazo")).toBeInTheDocument());
    expect(document.body.textContent).toContain("Trial sem data limite não vence");
  });

  it("omite a orientação quando não há trial sem prazo", async () => {
    mockarRpc([SAFRA_VAZIA], SINAIS_ZERADOS);

    renderizar();

    await waitFor(() => expect(screen.getByText("Trials sem prazo")).toBeInTheDocument());
    expect(document.body.textContent).not.toContain("Trial sem data limite não vence");
  });

  it("exibe o erro quando a RPC é negada para quem não é superadmin", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Acesso restrito ao Super Admin ArkeFit.") });

    renderizar();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Acesso restrito ao Super Admin ArkeFit.")
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReceitaHistoricoCard } from "./ReceitaHistoricoCard";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// A formatação pt-BR usa espaço não-quebrável entre "R$" e o número, o que
// quebra comparação literal — normaliza antes de procurar na tela.
const textoNormalizado = () => document.body.textContent?.replace(/\u00A0/g, " ") ?? "";

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReceitaHistoricoCard />
    </QueryClientProvider>
  );
};

describe("ReceitaHistoricoCard", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("mostra receita do mês, variação vs. mês anterior e MRR contratado", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          mes: "2026-08-01",
          receita_metodo_arke: 600,
          receita_mensalidades: 400,
          receita_b2b: 0,
          receita_total: 1000,
          repasse_arke: 200,
          mrr_contratado: null,
          arr_contratado: null,
        },
        {
          mes: "2026-09-01",
          receita_metodo_arke: 900,
          receita_mensalidades: 600,
          receita_b2b: 0,
          receita_total: 1500,
          repasse_arke: 260,
          mrr_contratado: 2000,
          arr_contratado: 24000,
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Receita do mês")).toBeInTheDocument());

    const texto = textoNormalizado();
    expect(texto).toContain("R$ 1.500,00"); // receita do último mês
    expect(texto).toContain("R$ 2.000,00"); // MRR contratado do snapshot
    expect(texto).toContain("R$ 24.000,00"); // ARR projetado
    // Cada KPI calcula a própria variação: receita 1000 -> 1500 (+50%),
    // repasse 200 -> 260 (+30%).
    expect(screen.getByText("+50.0% vs. mês anterior")).toBeInTheDocument();
    expect(screen.getByText("+30.0% vs. mês anterior")).toBeInTheDocument();
  });

  it("usa travessão quando o mês ainda não tem snapshot de MRR", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          mes: "2026-09-01",
          receita_metodo_arke: 100,
          receita_mensalidades: 0,
          receita_b2b: 0,
          receita_total: 100,
          repasse_arke: 30,
          mrr_contratado: null,
          arr_contratado: null,
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("MRR contratado")).toBeInTheDocument());
    // Sem snapshot do mês, MRR e ARR aparecem como "—" em vez de R$ 0,00,
    // que passaria a impressão errada de que a receita recorrente zerou.
    expect(screen.getAllByText("—")).toHaveLength(2);
    // Com receita > 0 o aviso de base vazia não deve aparecer.
    expect(textoNormalizado()).not.toContain("Ainda não há pagamentos confirmados");
  });

  it("avisa quando não há nenhum movimento na plataforma", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          mes: "2026-09-01",
          receita_metodo_arke: 0,
          receita_mensalidades: 0,
          receita_b2b: 0,
          receita_total: 0,
          repasse_arke: 0,
          mrr_contratado: 0,
          arr_contratado: 0,
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() =>
      expect(textoNormalizado()).toContain("Ainda não há pagamentos confirmados")
    );
  });

  it("exibe o erro quando a RPC é negada (ex.: usuário sem papel superadmin)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: new Error("Acesso restrito ao Super Admin ArkeFit."),
    });

    renderizar();

    await waitFor(() =>
      expect(textoNormalizado()).toContain("Acesso restrito ao Super Admin ArkeFit.")
    );
  });
});

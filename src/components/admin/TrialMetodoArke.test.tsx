import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrialMetodoArke } from "./TrialMetodoArke";

const rpc = vi.fn();
const toast = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const renderizar = (props: Partial<React.ComponentProps<typeof TrialMetodoArke>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrialMetodoArke
        alunoId="aluno-1"
        emTrial={false}
        trialFim={null}
        nivelAtual={null}
        {...props}
      />
    </QueryClientProvider>
  );
};

describe("TrialMetodoArke", () => {
  beforeEach(() => {
    rpc.mockReset();
    toast.mockReset();
  });

  it("inicia o trial no nível escolhido", async () => {
    rpc.mockResolvedValue({ error: null });

    renderizar();
    fireEvent.click(screen.getByRole("button", { name: /Iniciar trial/ }));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    // Sem nível anterior, o padrão é o mais barato — começar pelo Elite
    // ativaria nutrição e acolhimento que a academia pode não querer testar.
    expect(rpc).toHaveBeenCalledWith("iniciar_trial_metodo_arke", {
      _aluno_id: "aluno-1",
      _nivel: "essencial",
    });
  });

  it("parte do nível que o aluno já tem", async () => {
    rpc.mockResolvedValue({ error: null });

    renderizar({ nivelAtual: "elite" });
    fireEvent.click(screen.getByRole("button", { name: /Iniciar trial/ }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("iniciar_trial_metodo_arke", { _aluno_id: "aluno-1", _nivel: "elite" })
    );
  });

  it("mostra o prazo e oferece encerrar quando já está em trial", () => {
    renderizar({ emTrial: true, trialFim: "2026-10-05", nivelAtual: "integrado" });

    expect(document.body.textContent).toContain("Em trial de homologação até 05/10/2026");
    // A frase precisa dizer que não há cobrança: é a diferença entre isto e
    // uma assinatura de verdade.
    expect(document.body.textContent).toContain("sem cobrança");
    expect(screen.getByRole("button", { name: /Encerrar trial/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Iniciar trial/ })).not.toBeInTheDocument();
  });

  it("encerra o trial", async () => {
    rpc.mockResolvedValue({ error: null });

    renderizar({ emTrial: true, trialFim: "2026-10-05" });
    fireEvent.click(screen.getByRole("button", { name: /Encerrar trial/ }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("encerrar_trial_metodo_arke", { _aluno_id: "aluno-1" })
    );
  });

  it("mostra a mensagem do banco quando a permissão é negada", async () => {
    rpc.mockResolvedValue({ error: new Error("Apenas a equipe da academia ou a ArkeFit podem iniciar um trial.") });

    renderizar();
    fireEvent.click(screen.getByRole("button", { name: /Iniciar trial/ }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Não foi possível iniciar o trial",
          description: "Apenas a equipe da academia ou a ArkeFit podem iniciar um trial.",
          variant: "destructive",
        })
      )
    );
  });

  it("deixa claro que não passa pelo Asaas antes de iniciar", () => {
    renderizar();
    expect(document.body.textContent).toContain("sem passar pelo Asaas e sem gerar cobrança");
  });
});

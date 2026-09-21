import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AvisoRotinas, SaudeRotinas } from "./SaudeRotinas";
import { rotinasComProblema, type Rotina } from "@/lib/rotinas";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function rotina(parcial: Partial<Rotina>): Rotina {
  return {
    nome: "arke-ativacao-pendente",
    agendamento: "0 * * * *",
    ativa: true,
    situacao: "ok",
    ultima_execucao: "2026-09-21T16:00:00Z",
    ultimo_erro: null,
    falhas_7d: 0,
    execucoes_7d: 168,
    ...parcial,
  };
}

function montar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => rpc.mockReset());

describe("rotinasComProblema", () => {
  it("pega falha, parada e nunca rodou; ignora ok e desativada", () => {
    const lista = [
      rotina({ nome: "a", situacao: "ok" }),
      rotina({ nome: "b", situacao: "falhou" }),
      rotina({ nome: "c", situacao: "atrasada" }),
      rotina({ nome: "d", situacao: "nunca_rodou" }),
      rotina({ nome: "e", situacao: "desativada" }),
    ];
    expect(rotinasComProblema(lista).map((r) => r.nome)).toEqual(["b", "c", "d"]);
  });
});

describe("AvisoRotinas", () => {
  it("não aparece quando está tudo ok — aviso que sempre aparece deixa de ser lido", async () => {
    rpc.mockResolvedValue({ data: [rotina({}), rotina({ nome: "snapshot-mrr-diario" })], error: null });
    const { container } = montar(<AvisoRotinas />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("nomeia a rotina quando é uma só", async () => {
    rpc.mockResolvedValue({ data: [rotina({ nome: "arke-escalonamento-sla", situacao: "atrasada" })], error: null });
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/"arke-escalonamento-sla" parou de rodar/)).toBeInTheDocument();
  });

  it("conta quando são várias", async () => {
    rpc.mockResolvedValue({
      data: [rotina({ nome: "a", situacao: "falhou" }), rotina({ nome: "b", situacao: "atrasada" })],
      error: null,
    });
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/2 rotinas agendadas precisam de atenção/)).toBeInTheDocument();
  });
});

describe("SaudeRotinas", () => {
  it("mostra o erro da última execução que falhou", async () => {
    rpc.mockResolvedValue({
      data: [rotina({ situacao: "falhou", ultimo_erro: 'ERROR: relation "x" does not exist', falhas_7d: 3 })],
      error: null,
    });
    montar(<SaudeRotinas />);
    expect(await screen.findByText(/relation "x" does not exist/)).toBeInTheDocument();
    expect(screen.getByText(/3 com falha/)).toBeInTheDocument();
    expect(screen.getByText("falhou")).toBeInTheDocument();
  });
});

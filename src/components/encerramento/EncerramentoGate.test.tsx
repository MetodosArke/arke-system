import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { EncerramentoGate } from "./EncerramentoGate";
import { EncerramentoAcademia } from "@/components/admin/EncerramentoAcademia";

let encerramento: Record<string, unknown> | null = null;
let papel = "gestor";
let nivelSessao = "aal2";
let status = "ativo";
const rpc = vi.fn();
let tarefasAbertas: { id: string; motivo: string; created_at: string }[] = [];
const atualizarTarefa = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: nivelSessao, nextLevel: "aal2" }, error: null }),
        listFactors: () => Promise.resolve({ data: { totp: [{ id: "f1", status: "verified" }], all: [{ id: "f1", status: "verified" }] }, error: null }),
      },
    },
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                order: () => ({ range: () => Promise.resolve({ data: tabela === "tarefas" ? tarefasAbertas : [], error: null }) }),
              }),
            }),
          }),
        }),
      }),
      update: (dados: unknown) => ({
        eq: (_c: string, id: string) => ({
          select: () => {
            atualizarTarefa(id, dados);
            tarefasAbertas = tarefasAbertas.filter((t) => t.id !== id);
            return Promise.resolve({ data: [{ id }], error: null });
          },
        }),
      }),
    }),
    rpc: (nome: string, args: unknown) => {
      rpc(nome, args);
      if (nome === "get_encerramento_organizacao") return Promise.resolve({ data: encerramento ? [encerramento] : [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ organization: { id: "org-1", nome: "Academia Tietê", slug: "tiete", status }, organizationRole: papel, signOut: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/admin/ExportarContador", () => ({ ExportarContador: () => <button>Exportar para o contador</button> }));

const montar = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("EncerramentoGate", () => {
  beforeEach(() => {
    encerramento = null;
    papel = "gestor";
    status = "ativo";
    rpc.mockReset();
    tarefasAbertas = [];
    atualizarTarefa.mockReset();
  });

  it("sem encerramento, o painel segue igual", async () => {
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    expect(await screen.findByText("painel")).toBeInTheDocument();
  });

  it("durante o aviso, a gestão vê a data do término e o painel funciona", async () => {
    encerramento = { etapa: "aviso", iniciativa: "academia", termino_em: "2026-10-24", eliminacao_em: "2026-11-23", motivo: "x" };
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    expect(await screen.findByText("24/10/2026")).toBeInTheDocument();
    expect(screen.getByText("painel")).toBeInTheDocument();
  });

  it("durante o aviso, o aluno vê a data e até quando os dados dele ficam", async () => {
    encerramento = { etapa: "aviso", iniciativa: "academia", termino_em: "2026-10-24", eliminacao_em: "2026-11-23", motivo: null };
    papel = "aluno";
    montar(<EncerramentoGate publico="aluno"><p>app</p></EncerramentoGate>);
    const faixa = await screen.findByRole("status");
    expect(faixa.textContent).toContain("Academia Tietê vai encerrar o uso do ARKE em 24/10/2026");
    expect(faixa.textContent).toContain("Seus dados desta academia ficam até 23/11/2026");
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("durante o aviso, o professor não vê nada de diferente", async () => {
    encerramento = { etapa: "aviso", iniciativa: "academia", termino_em: "2026-10-24", eliminacao_em: "2026-11-23", motivo: null };
    papel = "professor";
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.getByText("painel")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("depois do término, a gestão fica só com a exportação até a data da eliminação", async () => {
    encerramento = { etapa: "encerrada", iniciativa: "arkefit", termino_em: "2026-09-24", eliminacao_em: "2026-10-24", motivo: "x" };
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    expect(await screen.findByText("Contrato encerrado")).toBeInTheDocument();
    expect(screen.queryByText("painel")).not.toBeInTheDocument();
    // Os exportadores são baixados quando aparecem (07/10/2026): chegam depois do cartão.
    expect(await screen.findByRole("button", { name: /Exportar todos os dados/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Exportar para o contador" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("24/10/2026");
  });

  it("depois do término, a gestão fecha com desfecho a remoção que ficou à mão", async () => {
    encerramento = { etapa: "encerrada", iniciativa: "academia", termino_em: "2026-09-24", eliminacao_em: "2026-10-24", motivo: "x" };
    tarefasAbertas = [
      { id: "t1", motivo: "Apagar do equipamento da catraca o usuário 12 — Encerramento da academia", created_at: "2026-09-24T03:00:00Z" },
    ];
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    expect(await screen.findByText("Falta apagar das catracas")).toBeInTheDocument();
    expect(screen.getByText(/usuário 12/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apaguei do equipamento" }));
    await waitFor(() =>
      expect(atualizarTarefa).toHaveBeenCalledWith("t1", { status: "concluida", desfecho_acao: expect.stringContaining("Apagado do equipamento") }),
    );
    await waitFor(() => expect(screen.queryByText("Falta apagar das catracas")).not.toBeInTheDocument());
  });

  it("sem remoção pendente, a tela da gestão não mostra a lista", async () => {
    encerramento = { etapa: "encerrada", iniciativa: "academia", termino_em: "2026-09-24", eliminacao_em: "2026-10-24", motivo: "x" };
    montar(<EncerramentoGate publico="equipe"><p>painel</p></EncerramentoGate>);
    expect(await screen.findByText("Contrato encerrado")).toBeInTheDocument();
    expect(screen.queryByText("Falta apagar das catracas")).not.toBeInTheDocument();
  });

  it("depois do término, o aluno é avisado e o app fecha", async () => {
    encerramento = { etapa: "encerrada", iniciativa: "academia", termino_em: "2026-09-24", eliminacao_em: "2026-10-24", motivo: null };
    papel = "aluno";
    montar(<EncerramentoGate publico="aluno"><p>app</p></EncerramentoGate>);
    expect(await screen.findByText("Sua academia encerrou o uso do ARKE")).toBeInTheDocument();
    expect(screen.queryByText("app")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Seus dados desta academia ficam guardados até 24/10/2026");
    expect(screen.getByRole("link", { name: "Política de Privacidade" })).toHaveAttribute("href", "/privacidade");
    expect(screen.queryByRole("button", { name: /Exportar/ })).not.toBeInTheDocument();
  });
});

describe("EncerramentoAcademia (Organização → Dados e encerramento)", () => {
  beforeEach(() => {
    encerramento = null;
    papel = "gestor";
    status = "ativo";
    rpc.mockReset();
    nivelSessao = "aal2";
  });

  it("sem a sessão verificada, o aviso só sai depois do código das duas etapas", async () => {
    nivelSessao = "aal1";
    montar(<EncerramentoAcademia />);
    fireEvent.click(await screen.findByRole("button", { name: /Encerrar o contrato/ }));
    fireEvent.change(screen.getByLabelText(/Por que a academia vai encerrar/), { target: { value: "Mudança de sistema" } });
    fireEvent.click(screen.getByRole("button", { name: "Avisar encerramento" }));
    expect(await screen.findByText(/Digite o código de 6 dígitos/)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("avisar_encerramento_organizacao", expect.anything());
  });

  it("a gestão avisa o encerramento por iniciativa da academia, com motivo", async () => {
    montar(<EncerramentoAcademia />);
    fireEvent.click(await screen.findByRole("button", { name: /Encerrar o contrato/ }));
    const avisar = screen.getByRole("button", { name: "Avisar encerramento" });
    expect(avisar).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Por que a academia vai encerrar/), { target: { value: "Mudança de sistema" } });
    fireEvent.click(avisar);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("avisar_encerramento_organizacao", {
        _organization_id: "org-1",
        _motivo: "Mudança de sistema",
        _iniciativa: "academia",
        _imediato: false,
      }),
    );
  });

  it("aviso da própria academia pode ser retirado; o da ArkeFit, não", async () => {
    encerramento = { etapa: "aviso", iniciativa: "academia", termino_em: "2026-10-24", eliminacao_em: "2026-11-23", motivo: "x" };
    const { unmount } = montar(<EncerramentoAcademia />);
    fireEvent.click(await screen.findByRole("button", { name: /Retirar o aviso/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("retirar_encerramento_organizacao", { _organization_id: "org-1" }));
    unmount();

    encerramento = { etapa: "aviso", iniciativa: "arkefit", termino_em: "2026-10-24", eliminacao_em: "2026-11-23", motivo: "x" };
    montar(<EncerramentoAcademia />);
    expect(await screen.findByText(/por decisão da ArkeFit/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retirar o aviso/ })).not.toBeInTheDocument();
  });

  it("não aparece para quem não é da gestão; em homologação, só a exportação", async () => {
    papel = "recepcao";
    const { container, unmount } = montar(<EncerramentoAcademia />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    papel = "gestor";
    status = "trial";
    montar(<EncerramentoAcademia />);
    expect(await screen.findByRole("button", { name: /Exportar todos os dados/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Encerrar o contrato/ })).not.toBeInTheDocument();
  });
});

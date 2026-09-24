import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import SuperAdminEquipamentos from "./SuperAdminEquipamentos";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => {
      const c = { select: () => c, eq: () => c, order: () => c, limit: () => c, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return c;
    },
  },
}));

const EQUIPAMENTO = {
  catraca_id: "c1",
  organization_id: "o1",
  academia: "Tietê Fitness",
  catraca: "Entrada",
  status_catraca: "ativo",
  situacao: "offline",
  versao: "1.0.0",
  modelo: "controlid",
  estado: "online",
  fila_offline: 3,
  cache_alunos: 120,
  ultima_sincronizacao: null,
  ultimo_erro: null,
  ultimo_erro_em: null,
  equipamentos: [],
  ponte: null,
  capacidades: [],
  reportado_em: new Date(Date.now() - 20 * 60_000).toISOString(),
  ultimo_heartbeat_em: null,
  comandos_pendentes: 0,
  comandos_falhos_7d: 2,
  acessos_hoje: 41,
  contingencias_7d: 1,
  checkins_parceiro_mes: 0,
};

const montar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SuperAdminEquipamentos />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// O Tabs do Radix troca de aba no mouseDown, não no click.
const abrirAba = (nome: RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name: nome }), { button: 0 });

describe("Visão Master → Equipamentos", () => {
  beforeEach(() => rpc.mockReset());

  it("lista a catraca sem sinal com o que precisa de ação", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: nome === "get_superadmin_equipamentos" ? [EQUIPAMENTO] : [], error: null })
    );
    montar();
    expect(await screen.findByText(/há 20 min/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("Tietê Fitness");
    expect(document.body.textContent).toContain("2 ordem(ns) falha(s)");
    expect(document.body.textContent).toContain("3 guardado(s)");
  });

  it("consulta de acessos só roda quando pedida, e mostra o aluno como código", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_superadmin_equipamentos") return Promise.resolve({ data: [EQUIPAMENTO], error: null });
      if (nome === "get_superadmin_acessos_catraca")
        return Promise.resolve({
          data: [
            {
              id: "l1",
              ocorrido_em: "2026-09-23T10:00:00Z",
              academia: "Tietê Fitness",
              catraca: "Entrada",
              resultado: "negado_pausado",
              giro: null,
              validado_offline: false,
              credencial: "identificador",
              aluno_ref: "A-3F09C1",
              parceiro_externo: null,
            },
          ],
          error: null,
        });
      return Promise.resolve({ data: [], error: null });
    });
    montar();
    abrirAba(/Acessos/);
    await screen.findByText(/Cada consulta fica/);
    // Abrir a aba não consulta: a consulta é auditada, então só com o clique.
    expect(rpc.mock.calls.some(([n]) => n === "get_superadmin_acessos_catraca")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Consultar/ }));
    expect(await screen.findByText("A-3F09C1")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Pausado");
    expect(document.body.textContent).toContain("Digital/cartão");
  });

  it("biometria destaca a remoção parada", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "get_superadmin_biometria"
            ? [
                {
                  organization_id: "o1",
                  academia: "Tietê Fitness",
                  consentimentos_vigentes: 10,
                  consentimentos_texto_antigo: 0,
                  alunos_com_identificador: 12,
                  revogacoes_30d: 1,
                  remocoes_em_andamento: 0,
                  remocoes_paradas: 1,
                  tarefas_equipamento_abertas: 0,
                },
              ]
            : [],
        error: null,
      })
    );
    montar();
    abrirAba(/Biometria/);
    await waitFor(() => expect(document.body.textContent).toContain("1 / 0"));
    expect(document.body.textContent).toContain("remoção parada");
  });

  it("mostra o erro quando a consulta é negada", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Acesso restrito à ArkeFit.") });
    montar();
    expect(await screen.findByText(/Acesso restrito à ArkeFit/)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OperacaoGlobalCard } from "./OperacaoGlobalCard";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const GATEWAY_BASE = {
  catraca_id: "c1",
  organization_id: "org-1",
  organizacao_nome: "Tietê Fitness",
  nome: "Catraca - Recepção",
  localizacao: "Recepção",
  status: "ativo",
  driver: "mock",
  ultimo_heartbeat_em: null,
  minutos_sem_heartbeat: null,
  situacao: "nunca_conectou",
  acessos_24h: 0,
};

const FILA_BASE = {
  organization_id: "org-1",
  organizacao_nome: "Tietê Fitness",
  status_org: "ativo",
  abertas: 3,
  vencidas: 1,
  criticas_abertas: 1,
  escaladas: 1,
  sem_responsavel: 2,
  concluidas_7d: 0,
  horas_pendencia_mais_antiga: 29,
};

const mockarRpc = (gateways: unknown[], fila: unknown[]) => {
  rpc.mockImplementation((nome: string) => {
    if (nome === "get_superadmin_gateways") return Promise.resolve({ data: gateways, error: null });
    if (nome === "get_superadmin_fila_global") return Promise.resolve({ data: fila, error: null });
    return Promise.resolve({ data: null, error: new Error(`RPC inesperada: ${nome}`) });
  });
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperacaoGlobalCard />
    </QueryClientProvider>
  );
};

/**
 * O Tabs do Radix troca de aba no mouseDown, não no click — um
 * fireEvent.click sozinho deixa o painel com data-state="inactive".
 */
const abrirAba = (nome: RegExp) => {
  const gatilho = screen.getByRole("tab", { name: nome });
  fireEvent.mouseDown(gatilho, { button: 0 });
};

describe("OperacaoGlobalCard", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("soma a fila de todas as academias", async () => {
    mockarRpc(
      [],
      [
        FILA_BASE,
        {
          ...FILA_BASE,
          organization_id: "org-2",
          organizacao_nome: "teste",
          abertas: 3,
          vencidas: 0,
          criticas_abertas: 0,
          escaladas: 0,
          horas_pendencia_mais_antiga: 9.5,
        },
      ]
    );

    renderizar();

    // Esperar pelo valor somado, e não por um rótulo estático como
    // "Pendências abertas": o rótulo já existe antes da query resolver, e
    // o waitFor passaria cedo demais.
    // 3 + 3 abertas.
    await waitFor(() => expect(screen.getByText("6")).toBeInTheDocument());
    // A idade da pendência mais antiga vira dias acima de 24h e horas
    // abaixo: 29h => "1d", 9.5h => "10h".
    expect(screen.getByText("1d")).toBeInTheDocument();
    expect(screen.getByText("10h")).toBeInTheDocument();
  });

  it("omite da lista academias sem nenhuma pendência", async () => {
    mockarRpc(
      [],
      [
        FILA_BASE,
        {
          ...FILA_BASE,
          organization_id: "org-3",
          organizacao_nome: "Teste Jean",
          abertas: 0,
          vencidas: 0,
          criticas_abertas: 0,
          escaladas: 0,
          sem_responsavel: 0,
          horas_pendencia_mais_antiga: null,
        },
      ]
    );

    renderizar();

    await waitFor(() => expect(screen.getByText("Tietê Fitness")).toBeInTheDocument());
    expect(screen.queryByText("Teste Jean")).not.toBeInTheDocument();
  });

  it("distingue catraca que nunca conectou de catraca offline", async () => {
    mockarRpc(
      [
        GATEWAY_BASE,
        {
          ...GATEWAY_BASE,
          catraca_id: "c2",
          organizacao_nome: "teste",
          situacao: "offline",
          ultimo_heartbeat_em: "2026-09-20T08:00:00Z",
          minutos_sem_heartbeat: 180,
        },
      ],
      []
    );

    renderizar();

    abrirAba(/Gateways/);

    await waitFor(() => expect(screen.getByText("Nunca conectou")).toBeInTheDocument());
    // "Offline" aparece duas vezes de propósito: no contador do resumo e na
    // linha do gateway. Conferir as duas garante que o resumo não ficou
    // desacoplado da lista.
    expect(screen.getAllByText("Offline")).toHaveLength(2);
    // "Nunca conectou" precisa explicar o que significa — é diferente de
    // ter caído, e a ação do time é outra (instalar vs. investigar queda).
    expect(document.body.textContent).toContain("nunca autenticou nesta unidade");
    // 180 min vira horas em vez de despejar o número cru.
    expect(document.body.textContent).toContain("3.0 h sem reportar");
  });

  it("deixa claro que o status do cadastro não é sinal de vida", async () => {
    mockarRpc([GATEWAY_BASE], []);

    renderizar();
    abrirAba(/Gateways/);

    await waitFor(() => expect(screen.getByText("Nunca conectou")).toBeInTheDocument());
    expect(document.body.textContent).toContain('continua "ativo" mesmo com a unidade desligada');
  });

  it("exibe o erro quando a RPC é negada para quem não é superadmin", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Acesso restrito ao Super Admin ArkeFit.") });

    renderizar();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Acesso restrito ao Super Admin ArkeFit.")
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FaseJornada } from "./FaseJornada";

const rpc = vi.fn();
const from = vi.fn();
const toast = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const mockarHistorico = (linhas: unknown[]) => {
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: linhas, error: null }),
        }),
      }),
    }),
  });
};

const renderizar = (faseAtual: Parameters<typeof FaseJornada>[0]["faseAtual"] = "base") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FaseJornada alunoId="aluno-1" faseAtual={faseAtual} />
    </QueryClientProvider>
  );
};

describe("FaseJornada", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    toast.mockReset();
    mockarHistorico([]);
  });

  it("não deixa mover para a fase em que o aluno já está", () => {
    renderizar("base");
    // Sem isto o botão convidaria a um clique que o banco ignora em silêncio.
    expect(screen.getByRole("button", { name: /Mover fase/ })).toBeDisabled();
  });

  it("rotula as cinco fases da jornada", () => {
    // O defeito que motivou esta tela era R.O.T.A.®, A.P.E.X.® e
    // L.E.G.A.D.O.® não terem caminho nenhum — ficavam inalcançáveis.
    // Renderizar em cada uma prova que as cinco são representáveis e têm
    // rótulo; abrir o dropdown para clicar não é testável aqui, porque o
    // Popper do Radix não estabiliza no jsdom. O caminho completo (mover,
    // gravar histórico, barrar quem não é equipe) foi validado no banco.
    const esperado: [Parameters<typeof FaseJornada>[0]["faseAtual"], string][] = [
      ["mapa", "M.A.P.A.®"],
      ["base", "B.A.S.E.®"],
      ["rota", "R.O.T.A.®"],
      ["apex", "A.P.E.X.®"],
      ["legado", "L.E.G.A.D.O.®"],
    ];
    for (const [fase, rotulo] of esperado) {
      const { unmount } = renderizar(fase);
      expect(screen.getByRole("combobox", { name: /Fase da jornada/ }).textContent).toContain(rotulo);
      unmount();
    }
  });

  it("aceita a observação do movimento", () => {
    renderizar("base");
    const campo = screen.getByPlaceholderText(/Por que está mudando de fase/);
    fireEvent.change(campo, { target: { value: "check-ins semanais em dia" } });
    expect((campo as HTMLInputElement).value).toBe("check-ins semanais em dia");
  });

  it("mostra quem moveu, quando e por quê", async () => {
    mockarHistorico([
      {
        id: "h1",
        fase_anterior: "base",
        fase_nova: "rota",
        movido_por_nome: "André Alves",
        observacao: "check-ins em dia",
        created_at: "2026-09-20T13:30:00Z",
      },
    ]);

    renderizar("rota");

    await waitFor(() => expect(document.body.textContent).toContain("André Alves"));
    // O histórico existe para explicar a mudança depois — origem, destino e
    // motivo precisam aparecer juntos.
    expect(document.body.textContent).toContain("B.A.S.E.®");
    expect(document.body.textContent).toContain("R.O.T.A.®");
    expect(document.body.textContent).toContain("check-ins em dia");
  });

  it("identifica como equipe quando o autor não tem nome no perfil", async () => {
    mockarHistorico([
      {
        id: "h1",
        fase_anterior: null,
        fase_nova: "legado",
        movido_por_nome: null,
        observacao: null,
        created_at: "2026-09-20T13:30:00Z",
      },
    ]);

    renderizar("legado");

    await waitFor(() => expect(document.body.textContent).toContain("equipe"));
    // fase_anterior nula aparece como travessão, não como "null".
    expect(document.body.textContent).toContain("—");
  });

});

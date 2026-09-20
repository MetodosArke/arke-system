import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperAdminAuditoria from "./SuperAdminAuditoria";

const order = vi.fn();
const limit = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => limit(),
        }),
      }),
    }),
  },
}));

const REGISTRO_BASE = {
  id: "1",
  ator_user_id: "u1",
  ator_email: "dono@arke.com.br",
  acao: "organizacao.excluida",
  entidade: "organizations",
  entidade_id: "org-1",
  organizacao_nome: "Academia Vida Ativa",
  detalhes: {},
  created_at: "2026-09-20T10:00:00Z",
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminAuditoria />
    </QueryClientProvider>
  );
};

describe("SuperAdminAuditoria", () => {
  beforeEach(() => {
    limit.mockReset();
    order.mockReset();
  });

  it("traduz a ação técnica para um rótulo legível e mostra ator e organização", async () => {
    limit.mockResolvedValue({ data: [REGISTRO_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Organização excluída")).toBeInTheDocument());
    expect(screen.getByText("Academia Vida Ativa")).toBeInTheDocument();
    expect(document.body.textContent).toContain("dono@arke.com.br");
  });

  it("formata o diff de detalhes como de → para", async () => {
    limit.mockResolvedValue({
      data: [
        {
          ...REGISTRO_BASE,
          acao: "organizacao.suspensa",
          detalhes: {
            status: { de: "ativo", para: "suspenso" },
            plano_b2b: { de: "growth", para: "enterprise" },
          },
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Organização suspensa")).toBeInTheDocument());
    expect(screen.getByText("status: ativo → suspenso")).toBeInTheDocument();
    expect(screen.getByText("plano_b2b: growth → enterprise")).toBeInTheDocument();
  });

  it("mostra 'sistema' quando a ação não tem ator identificado", async () => {
    limit.mockResolvedValue({
      data: [{ ...REGISTRO_BASE, ator_user_id: null, ator_email: null }],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Organização excluída")).toBeInTheDocument());
    expect(document.body.textContent).toContain("sistema");
  });

  it("filtra por busca sem perder o total original", async () => {
    limit.mockResolvedValue({
      data: [
        REGISTRO_BASE,
        {
          ...REGISTRO_BASE,
          id: "2",
          acao: "perfil.simulado",
          organizacao_nome: "Studio Corpo em Movimento",
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("2 registros")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Buscar por organização/), {
      target: { value: "Studio" },
    });

    // O contador precisa deixar claro que há um filtro ativo, em vez de
    // simplesmente afirmar que só existe 1 registro no log.
    await waitFor(() => expect(screen.getByText("1 registro de 2")).toBeInTheDocument());
    expect(screen.queryByText("Academia Vida Ativa")).not.toBeInTheDocument();
  });

  it("explica que o log começa agora quando está vazio", async () => {
    limit.mockResolvedValue({ data: [], error: null });

    renderizar();

    await waitFor(() =>
      expect(screen.getByText("Nenhuma ação sensível registrada ainda.")).toBeInTheDocument()
    );
    expect(document.body.textContent).toContain("não foram gravadas");
  });

  it("exibe o erro quando a leitura é negada para quem não é superadmin", async () => {
    limit.mockResolvedValue({ data: null, error: new Error("permission denied") });

    renderizar();

    await waitFor(() => expect(document.body.textContent).toContain("permission denied"));
  });
});

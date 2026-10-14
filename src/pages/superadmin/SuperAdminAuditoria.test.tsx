import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperAdminAuditoria from "./SuperAdminAuditoria";
import { baixarCsv } from "@/lib/exportarPlanilha";

const order = vi.fn();
const limit = vi.fn();
const rpc = vi.fn();
const range = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => limit(),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => {
      rpc(...args);
      const consulta = { order: () => consulta, range: (de: number, ate: number) => range(de, ate) };
      return consulta;
    },
  },
}));

vi.mock("@/lib/exportarPlanilha", async (original) => ({
  ...(await original<typeof import("@/lib/exportarPlanilha")>()),
  baixarCsv: vi.fn(),
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

  it("mostra 'servidor' quando a ação não tem ator identificado (a service role ou uma migration)", async () => {
    limit.mockResolvedValue({
      data: [{ ...REGISTRO_BASE, ator_user_id: null, ator_email: null }],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Organização excluída")).toBeInTheDocument());
    expect(document.body.textContent).toContain("servidor ·");
  });

  it("exporta o período num CSV, com as três fontes e o servidor como autor da ação sem pessoa", async () => {
    limit.mockResolvedValue({ data: [], error: null });
    const linha = {
      registro: "acao_sensivel",
      chave: "a1",
      quando: "2026-10-14T10:00:00-03:00",
      ultimo_em: null,
      pessoa_id: null,
      email_de_quem_fez: null,
      ip: null,
      ip_hash: null,
      email_hash: null,
      acao: "configuracao.alterada",
      entidade: "plataforma_config",
      entidade_id: null,
      organizacao: null,
      detalhes: { chave: "vigia_ativo", valor: { de: 0, para: 1 } },
    };
    const acesso = { ...linha, registro: "acesso", chave: "b2", ip: "200.1.2.3", pessoa_id: "u9", acao: null, entidade: null, detalhes: null };
    range.mockResolvedValue({ data: [linha, acesso], error: null });

    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: /Exportar o período/ }));

    await waitFor(() => expect(baixarCsv).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("exportar_trilha_auditoria", expect.objectContaining({ _de: expect.any(String), _ate: expect.any(String) }));
    expect(range).toHaveBeenCalledWith(0, 999);
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toMatch(/^trilha-de-auditoria_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(linhas[0]).toEqual(expect.arrayContaining(["registro", "quando", "quem_fez", "ip", "ip_hash", "email_hash", "detalhes"]));
    expect(linhas[1]).toEqual(expect.arrayContaining(["acao_sensivel", "servidor", "configuracao.alterada", JSON.stringify(linha.detalhes)]));
    expect(linhas[2]).toEqual(expect.arrayContaining(["acesso", "u9", "200.1.2.3"]));
    expect(linhas[2][4]).toBe("");
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

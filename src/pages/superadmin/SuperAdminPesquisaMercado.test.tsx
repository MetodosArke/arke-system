import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperAdminPesquisaMercado from "./SuperAdminPesquisaMercado";
import { baixarCsv } from "@/lib/exportarPlanilha";

const range = vi.fn();
const emails = vi.fn();
let socio = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "exportar_emails_pesquisa_mercado") return emails();
      const consulta = { order: () => consulta, range: (de: number, ate: number) => range(de, ate) };
      return consulta;
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ acessoArkefit: { socio, niveis: socio ? [] : ["comercial"] } }),
}));

vi.mock("@/lib/exportarPlanilha", async (original) => ({
  ...(await original<typeof import("@/lib/exportarPlanilha")>()),
  baixarCsv: vi.fn(),
}));

const linha = (id: string, respostas: Record<string, unknown>) => ({ id, versao: 1, respondida_em: "2026-10-15", respostas });

const renderizar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SuperAdminPesquisaMercado />
    </QueryClientProvider>,
  );

describe("SuperAdminPesquisaMercado", () => {
  beforeEach(() => {
    range.mockReset();
    emails.mockReset();
    vi.mocked(baixarCsv).mockReset();
    socio = false;
  });

  it("mostra o total, a distribuição e o CSV das respostas; o Comercial não vê os e-mails", async () => {
    range.mockResolvedValue({
      data: [linha("a", { papel: "gestor", recurso_para_trocar: "Cobrança que funcione" }), linha("b", { papel: "gestor" })],
      error: null,
    });
    renderizar();
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(screen.getByText("Cobrança que funcione")).toBeInTheDocument();
    expect(document.body.textContent).toContain("2 · 100%");
    expect(screen.queryByText(/E-mails para o resultado/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Respostas (CSV)"));
    expect(baixarCsv).toHaveBeenCalledWith(expect.stringMatching(/^pesquisa-de-mercado_.*\.csv$/), expect.any(Array));
  });

  it("o Sócio baixa os e-mails num CSV à parte", async () => {
    socio = true;
    range.mockResolvedValue({ data: [linha("a", { papel: "gestor" })], error: null });
    emails.mockResolvedValue({ data: [{ email: "dono@exemplo.com", resultado_autorizado_em: "2026-10-15T12:00:00Z", conhecer_autorizado_em: null }], error: null });
    renderizar();
    fireEvent.click(await screen.findByText("E-mails para o resultado (CSV)"));
    await waitFor(() => expect(baixarCsv).toHaveBeenCalledWith(expect.stringMatching(/emails/), expect.any(Array)));
    const linhas = vi.mocked(baixarCsv).mock.calls[0][1];
    expect(linhas[1][0]).toBe("dono@exemplo.com");
  });

  it("a consulta que falha diz que falhou, e não que está vazia", async () => {
    range.mockResolvedValue({ data: null, error: { message: "falhou" } });
    renderizar();
    expect(await screen.findByText(/Não foi possível carregar as respostas da pesquisa/)).toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma resposta ainda/)).not.toBeInTheDocument();
  });
});

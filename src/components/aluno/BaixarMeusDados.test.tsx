import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
const toast = vi.fn();
const lerMeusDados = vi.fn();
const baixarJson = vi.fn();
let simuladoNaAba = false;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "maria@exemplo.com" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/impersonation", () => ({ emPerfilSimulado: () => simuladoNaAba }));
vi.mock("@/lib/meusDados", async (original) => ({
  ...(await original<typeof import("@/lib/meusDados")>()),
  lerMeusDados: (...a: unknown[]) => lerMeusDados(...a),
  baixarJson: (...a: unknown[]) => baixarJson(...a),
}));

const { BaixarMeusDados } = await import("./BaixarMeusDados");
const { RECUSA_SIMULADO } = await import("@/lib/meusDados");

const leituraVazia = new Proxy({}, { get: (_, chave) => (chave === "email" || chave === "perfil" ? null : []) });

beforeEach(() => {
  rpc.mockReset();
  toast.mockReset();
  lerMeusDados.mockReset();
  baixarJson.mockReset();
  simuladoNaAba = false;
});

describe("BaixarMeusDados", () => {
  it("baixa o arquivo da própria pessoa", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    lerMeusDados.mockResolvedValue(leituraVazia);
    render(<BaixarMeusDados />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar os meus dados" }));
    await waitFor(() => expect(baixarJson).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("sessao_simulada");
    expect(lerMeusDados).toHaveBeenCalledWith("user-1", "maria@exemplo.com");
    expect(baixarJson.mock.calls[0][0]).toMatch(/^meus-dados-arkefit-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("na aba em perfil simulado, o botão nem funciona e a tela diz por quê", () => {
    simuladoNaAba = true;
    render(<BaixarMeusDados />);
    expect(screen.getByRole("button", { name: "Baixar os meus dados" })).toBeDisabled();
    expect(screen.getByText(RECUSA_SIMULADO)).toBeInTheDocument();
  });

  it("o banco diz que a sessão é simulada: recusa sem ler nada", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    render(<BaixarMeusDados />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar os meus dados" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: RECUSA_SIMULADO, variant: "destructive" })));
    expect(lerMeusDados).not.toHaveBeenCalled();
    expect(baixarJson).not.toHaveBeenCalled();
  });

  it("leitura que falha não entrega arquivo incompleto", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    lerMeusDados.mockRejectedValue(new Error("permission denied for table mensagens_dieta"));
    render(<BaixarMeusDados />);
    fireEvent.click(screen.getByRole("button", { name: "Baixar os meus dados" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Não foi possível baixar agora" })));
    expect(baixarJson).not.toHaveBeenCalled();
    // A mensagem do banco não vai para a tela.
    expect(JSON.stringify(toast.mock.calls)).not.toMatch(/mensagens_dieta/);
  });
});

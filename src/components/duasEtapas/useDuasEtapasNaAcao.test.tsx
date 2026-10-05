import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDuasEtapasNaAcao } from "./useDuasEtapasNaAcao";

const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { mfa } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

function Tela({ acao }: { acao: () => void }) {
  const { exigir, dialogo } = useDuasEtapasNaAcao("Exportar pede o código.");
  return (
    <>
      <button onClick={() => void exigir(acao)}>Exportar</button>
      {dialogo}
    </>
  );
}

const montar = (acao: () => void) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Tela acao={acao} />
    </QueryClientProvider>,
  );

describe("ação que pede as duas etapas", () => {
  beforeEach(() => {
    Object.values(mfa).forEach((f) => f.mockReset());
    mfa.unenroll.mockResolvedValue({ error: null });
  });

  it("sessão já verificada: a ação roda direto, sem janela", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    const acao = vi.fn();
    montar(acao);
    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sem verificação: a ação só roda depois do código certo, uma vez", async () => {
    mfa.getAuthenticatorAssuranceLevel
      .mockResolvedValueOnce({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })
      .mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1", status: "verified" }], all: [{ id: "f1", status: "verified" }] }, error: null });
    mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: "invalid" } }).mockResolvedValue({ error: null });
    const acao = vi.fn();
    montar(acao);
    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
    expect(await screen.findByText("Exportar pede o código.")).toBeInTheDocument();
    expect(await screen.findByText(/Digite o código de 6 dígitos/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/Código não confere/)).toBeInTheDocument();
    expect(acao).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("quem nunca ativou ativa na própria janela, pelo QR code", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
    mfa.enroll.mockResolvedValue({ data: { id: "novo", totp: { qr_code: "data:image/svg+xml;base64,AAA", secret: "SEGREDO" } }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    const acao = vi.fn();
    montar(acao);
    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(acao).toHaveBeenCalledTimes(1));
    expect(mfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "novo", code: "654321" });
  });
});

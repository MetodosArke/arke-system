import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VerificacaoDuasEtapas } from "./VerificacaoDuasEtapas";

const mfa = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { mfa } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VerificacaoDuasEtapas>
        <p>Visão Master</p>
      </VerificacaoDuasEtapas>
    </QueryClientProvider>,
  );

describe("VerificacaoDuasEtapas", () => {
  beforeEach(() => {
    Object.values(mfa).forEach((f) => f.mockReset());
    mfa.unenroll.mockResolvedValue({ error: null });
  });

  it("sessão já verificada entra direto", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    montar();
    expect(await screen.findByText("Visão Master")).toBeInTheDocument();
  });

  it("sem aplicativo cadastrado: mostra o QR code, limpa cadastro pela metade e só entra com o código certo", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: "velho", status: "unverified" }] }, error: null });
    mfa.enroll.mockResolvedValue({ data: { id: "fator-1", totp: { qr_code: "data:image/svg+xml;base64,AAA", secret: "SEGREDO123" } }, error: null });
    mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: "invalid" } }).mockResolvedValueOnce({ error: null });
    montar();
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute("src", "data:image/svg+xml;base64,AAA");
    expect(screen.getByText("SEGREDO123")).toBeInTheDocument();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "velho" });
    expect(screen.queryByText("Visão Master")).not.toBeInTheDocument();

    const campo = screen.getByLabelText("Código");
    fireEvent.change(campo, { target: { value: "12a34" } });
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();
    fireEvent.change(campo, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/Código não confere/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByText("Visão Master")).toBeInTheDocument());
    expect(mfa.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: "fator-1", code: "123456" });
  });

  it("com aplicativo já cadastrado: só pede o código", async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "fator-9", status: "verified" }], all: [{ id: "fator-9", status: "verified" }] }, error: null });
    mfa.challengeAndVerify.mockResolvedValue({ error: null });
    montar();
    expect(await screen.findByText(/Digite o código de 6 dígitos do aplicativo/)).toBeInTheDocument();
    expect(mfa.enroll).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByText("Visão Master")).toBeInTheDocument());
  });
});

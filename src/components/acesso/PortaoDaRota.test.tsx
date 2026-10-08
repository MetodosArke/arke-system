import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PortaoDaRota } from "./PortaoDaRota";
import { FaixaModoEssencial } from "./ModoEssencial";
import { ModoEssencialContext } from "@/contexts/ModoEssencialContext";
import { AVISO_MODO_ESSENCIAL } from "@/lib/modoEssencial";

const auth = { organizationRole: "recepcao", organization: { tipo: "academia", especialidadeProfissional: null }, hasRole: () => false };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function abrir(caminho: string, modoEssencial: boolean) {
  return render(
    <ModoEssencialContext.Provider value={modoEssencial}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route
            path="/admin/*"
            element={
              <PortaoDaRota>
                <div>a tela</div>
              </PortaoDaRota>
            }
          />
        </Routes>
      </MemoryRouter>
    </ModoEssencialContext.Provider>,
  );
}

describe("PortaoDaRota no modo essencial", () => {
  it("a rota pausada, aberta pelo endereço, mostra a explicação no lugar da tela", () => {
    for (const rota of ["/admin/funil", "/admin/comunicados", "/admin/engajamento", "/admin/onboarding"]) {
      const { unmount } = abrir(rota, true);
      expect(screen.getByRole("alert"), rota).toHaveTextContent("Esta função está pausada");
      expect(screen.getByRole("alert")).toHaveTextContent(AVISO_MODO_ESSENCIAL);
      expect(screen.queryByText("a tela"), rota).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/admin/dashboard");
      unmount();
    }
  });

  it("o atendimento do balcão abre", () => {
    for (const rota of ["/admin", "/admin/dashboard", "/admin/alunos", "/admin/checkin-qr", "/admin/catracas", "/admin/mensagens", "/admin/perfil", "/admin/ajuda/painel-primeiros-passos"]) {
      const { unmount } = abrir(rota, true);
      expect(screen.getByText("a tela"), rota).toBeInTheDocument();
      unmount();
    }
  });

  it("o que o papel já não abria segue com a explicação do papel", () => {
    abrir("/admin/financeiro", true);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta página não faz parte do seu acesso");
  });

  it("fora do modo essencial, a recepção abre o que o papel abre", () => {
    abrir("/admin/funil", false);
    expect(screen.getByText("a tela")).toBeInTheDocument();
  });

  it("a faixa do topo: o aviso, sem valor e sem link", () => {
    render(<FaixaModoEssencial />);
    expect(screen.getByRole("status")).toHaveTextContent(AVISO_MODO_ESSENCIAL);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/R\$/);
  });
});

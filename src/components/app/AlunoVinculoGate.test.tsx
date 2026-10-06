import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * A rota `/app` não pede papel. Até 06/10/2026, quem chegava sem cadastro de
 * aluno ficava na home em "carregando" para sempre, e a falha de rede ao ler o
 * acesso mandava a gestão para cá.
 */

const estado = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => estado.auth,
}));

import { AlunoVinculoGate } from "./AlunoVinculoGate";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const BASE = {
  isAuthenticated: true,
  isLoading: false,
  rolesLoaded: true,
  erroAcesso: false,
  roles: [],
  organizationRole: null,
  organization: null,
  alunoId: null,
  signOut: vi.fn(),
  tentarAcessoDeNovo: vi.fn(),
};

function abrirApp() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AlunoVinculoGate>
                <p>home do aluno</p>
              </AlunoVinculoGate>
            </ProtectedRoute>
          }
        />
        <Route path="/admin/dashboard" element={<p>painel da equipe</p>} />
        <Route path="/superadmin" element={<p>visão master</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AlunoVinculoGate", () => {
  beforeEach(() => {
    estado.auth = { ...BASE };
  });

  it("aluno com cadastro entra", () => {
    estado.auth = { ...BASE, alunoId: "aluno-1", organizationRole: "aluno" };
    abrirApp();
    expect(screen.getByText("home do aluno")).toBeInTheDocument();
  });

  it("conta sem vínculo vê o motivo e pode sair, em vez de carregar para sempre", () => {
    abrirApp();
    expect(screen.getByText("Nenhuma academia vinculada a esta conta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sair/ })).toBeInTheDocument();
    expect(screen.queryByText("home do aluno")).not.toBeInTheDocument();
  });

  it("a equipe que abre o app do aluno volta para o painel", () => {
    estado.auth = { ...BASE, organizationRole: "professor", organization: { id: "org-1", tipo: "academia" } };
    abrirApp();
    expect(screen.getByText("painel da equipe")).toBeInTheDocument();
  });

  it("espera os papéis antes de decidir", () => {
    estado.auth = { ...BASE, rolesLoaded: false };
    abrirApp();
    expect(screen.queryByText("Nenhuma academia vinculada a esta conta")).not.toBeInTheDocument();
    expect(screen.queryByText("home do aluno")).not.toBeInTheDocument();
  });

  it("a gestão com falha ao ler o acesso não cai no app do aluno", () => {
    estado.auth = { ...BASE, rolesLoaded: false, erroAcesso: true };
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <ProtectedRoute requiredRoles={["gestor", "professor"]}>
                <p>painel da equipe</p>
              </ProtectedRoute>
            }
          />
          <Route path="/app" element={<p>app do aluno</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Não conseguimos carregar o seu acesso")).toBeInTheDocument();
    expect(screen.queryByText("app do aluno")).not.toBeInTheDocument();
  });

  it("falha ao ler o acesso mostra o erro e o Tentar de novo, sem redirecionar", () => {
    estado.auth = { ...BASE, rolesLoaded: false, erroAcesso: true };
    abrirApp();
    expect(screen.getByText("Não conseguimos carregar o seu acesso")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(BASE.tentarAcessoDeNovo).toHaveBeenCalled();
    expect(screen.queryByText("Nenhuma academia vinculada a esta conta")).not.toBeInTheDocument();
  });
});

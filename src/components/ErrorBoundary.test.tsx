import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

const reportarErro = vi.fn();
vi.mock("@/lib/monitoramento", () => ({ reportarErro: (...a: unknown[]) => reportarErro(...a) }));

import { ErrorBoundary, FronteiraDaTela } from "./ErrorBoundary";

function TelaQueQuebra(): JSX.Element {
  throw new Error("defeito de render");
}

// Um layout como os do app: o menu fora da fronteira, o conteúdo dentro.
function Layout() {
  return (
    <div>
      <nav>
        <Link to="/admin/quebra">Quebra</Link>
        <Link to="/admin/alunos">Alunos</Link>
      </nav>
      <main>
        <FronteiraDaTela>
          <Outlet />
        </FronteiraDaTela>
      </main>
    </div>
  );
}

function app(inicial: string) {
  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[inicial]}>
        <Routes>
          <Route path="/admin" element={<Layout />}>
            <Route path="quebra" element={<TelaQueQuebra />} />
            <Route path="alunos" element={<p>Lista de alunos</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ErrorBoundary>,
  );
}

describe("fronteira de erro por área", () => {
  beforeEach(() => {
    reportarErro.mockClear();
    // O React escreve o erro capturado no console; o teste não precisa dele.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("o erro de uma tela aparece dentro do layout, com o menu de pé, e vai ao Sentry", () => {
    app("/admin/quebra");
    expect(screen.getByRole("alert")).toHaveTextContent("Esta tela teve um problema");
    expect(screen.queryByText("Algo deu errado ao carregar o aplicativo")).toBeNull();
    expect(screen.getByRole("link", { name: "Alunos" })).toBeInTheDocument();
    expect(reportarErro).toHaveBeenCalledTimes(1);
  });

  it("ir para outra rota pelo menu limpa o erro", () => {
    app("/admin/quebra");
    fireEvent.click(screen.getByRole("link", { name: "Alunos" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Lista de alunos")).toBeInTheDocument();
  });

  it("voltar para a tela que quebrou mostra o erro de novo, sem derrubar o app", () => {
    app("/admin/alunos");
    fireEvent.click(screen.getByRole("link", { name: "Quebra" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Esta tela teve um problema");
    expect(screen.getByRole("link", { name: "Alunos" })).toBeInTheDocument();
  });

  it("o erro fora de uma área cai na fronteira da raiz", () => {
    render(
      <ErrorBoundary>
        <TelaQueQuebra />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Algo deu errado ao carregar o aplicativo");
  });
});

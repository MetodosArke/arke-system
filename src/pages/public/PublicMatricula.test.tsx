import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import PublicMatricula from "./PublicMatricula";
import { CONTA_JA_EXISTE } from "../../../supabase/functions/matricula-publica/fluxo";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/p/tiete-fitness"]}>
        <Routes>
          <Route path="/p/:slug" element={<PublicMatricula />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const ACADEMIA = { data: [{ organization_id: "o1", nome: "Tietê Fitness" }], error: null };

async function preencherEEnviar() {
  await screen.findByText(/seus dados/i);
  fireEvent.change(screen.getByLabelText(/nome completo/i), { target: { value: "Ana Souza" } });
  fireEvent.change(screen.getByLabelText(/^e-mail$/i), { target: { value: "ana@exemplo.com" } });
  fireEvent.change(screen.getByLabelText(/^cpf$/i), { target: { value: "529.982.247-25" } });
  fireEvent.change(screen.getByLabelText(/data de nascimento/i), { target: { value: "1990-05-10" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /confirmar matrícula/i }));
}

beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

describe("PublicMatricula", () => {
  it("academia que não existe: diz que não foi encontrada", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    montar();
    expect(await screen.findByText(/academia não encontrada/i)).toBeInTheDocument();
  });

  it("falha de rede não se passa por academia inexistente", async () => {
    // Antes as duas caíam na mesma tela: quem tinha o link certo lia que a
    // academia não existe por causa de um soluço de conexão.
    rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    montar();
    expect(await screen.findByText(/não foi possível carregar a matrícula/i)).toBeInTheDocument();
    expect(screen.queryByText(/academia não encontrada/i)).not.toBeInTheDocument();
  });

  it("tentar de novo recupera quando a conexão volta", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } })
      .mockResolvedValue({ data: [{ organization_id: "o1", nome: "Tietê Fitness", planos: [] }], error: null });
    montar();

    fireEvent.click(await screen.findByRole("button", { name: /tentar de novo/i }));
    await waitFor(() => expect(screen.getAllByText(/tietê fitness/i).length).toBeGreaterThan(0));
  });
});

// Decisão de 07/10/2026: a matrícula pública só cria conta usável depois do
// link do e-mail. O formulário não pede senha, e a tela não entra no app.
describe("PublicMatricula sem senha", () => {
  it("o formulário não pede senha", async () => {
    rpc.mockResolvedValue(ACADEMIA);
    montar();
    await screen.findByText(/seus dados/i);
    expect(screen.queryByLabelText(/senha/i)).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("manda os dados sem senha e diz que o link de criar a senha foi para o e-mail", async () => {
    rpc.mockResolvedValue(ACADEMIA);
    invoke.mockResolvedValue({ data: { ok: true, email_enviado: true }, error: null });
    montar();
    await preencherEEnviar();

    expect(await screen.findByText("Matrícula feita!")).toBeInTheDocument();
    expect(screen.getByText("Enviamos para o seu e-mail um link para criar a sua senha.")).toBeInTheDocument();
    expect(screen.getByText("ana@exemplo.com")).toBeInTheDocument();

    expect(invoke).toHaveBeenCalledTimes(1);
    const [funcao, { body }] = invoke.mock.calls[0];
    expect(funcao).toBe("matricula-publica");
    expect(body).not.toHaveProperty("password");
    expect(body).toMatchObject({
      slug: "tiete-fitness",
      full_name: "Ana Souza",
      email: "ana@exemplo.com",
      cpf: "529.982.247-25",
      data_nascimento: "1990-05-10",
      aceite_termos: true,
    });
    // O caminho para pedir o link de novo é o primeiro acesso da academia.
    const pedirDeNovo = screen.getByRole("link", { name: "Não chegou? Pedir o link de novo" });
    expect(pedirDeNovo).toHaveAttribute("href", "/p/tiete-fitness/primeiro-acesso");
    expect(screen.getByRole("link", { name: "Já criei a senha: entrar" })).toHaveAttribute("href", "/p/tiete-fitness/entrar");
  });

  it("o e-mail que não saiu aponta o primeiro acesso, sem dizer que foi enviado", async () => {
    rpc.mockResolvedValue(ACADEMIA);
    invoke.mockResolvedValue({ data: { ok: true, email_enviado: false }, error: null });
    montar();
    await preencherEEnviar();

    expect(await screen.findByText("Matrícula feita!")).toBeInTheDocument();
    expect(screen.queryByText(/enviamos para o seu e-mail/i)).toBeNull();
    expect(screen.getByText(/não saiu agora/i)).toBeInTheDocument();
  });

  it("o e-mail que já tem conta: a resposta da função fica na tela, com o caminho", async () => {
    rpc.mockResolvedValue(ACADEMIA);
    const resposta = new Response(JSON.stringify({ error: CONTA_JA_EXISTE }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(resposta) });
    montar();
    await preencherEEnviar();

    expect(await screen.findByRole("alert")).toHaveTextContent(CONTA_JA_EXISTE);
    expect(screen.queryByText("Matrícula feita!")).toBeNull();
  });
});

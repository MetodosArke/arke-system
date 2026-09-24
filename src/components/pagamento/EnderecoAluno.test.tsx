import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnderecoAluno } from "./EnderecoAluno";

let perfil: Record<string, string | null> | null = null;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () =>
          tabela === "alunos"
            ? { single: () => Promise.resolve({ data: { user_id: "user-1" }, error: null }) }
            : { maybeSingle: () => Promise.resolve({ data: perfil, error: null }) },
      }),
    }),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/brasilApi", async (original) => ({
  ...(await original<typeof import("@/lib/brasilApi")>()),
  buscarCep: () => Promise.resolve({ cep: "01310-100", logradouro: "Avenida Paulista", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP" }),
}));

const montar = (podeEditar: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EnderecoAluno alunoId="aluno-1" podeEditar={podeEditar} />
    </QueryClientProvider>,
  );

describe("EnderecoAluno", () => {
  beforeEach(() => {
    perfil = null;
    rpc.mockReset();
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("para quem só lê, mostra o endereço salvo numa linha", async () => {
    perfil = { cep: "01310100", logradouro: "Avenida Paulista", endereco_numero: "1000", complemento: "ap 12", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP" };
    montar(false);
    await waitFor(() => expect(screen.getByText(/Avenida Paulista, 1000/)).toBeInTheDocument());
    expect(document.body.textContent).toContain("01310-100");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("para quem só lê e não há endereço, diz isso", async () => {
    montar(false);
    await waitFor(() => expect(screen.getByText("Sem endereço cadastrado.")).toBeInTheDocument());
  });

  it("o CEP completa a rua, e só salva com o número", async () => {
    montar(true);
    const salvar = await screen.findByRole("button", { name: "Salvar endereço" });
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "01310100" } });
    await waitFor(() => expect(screen.getByLabelText("Rua")).toHaveValue("Avenida Paulista"));
    expect(screen.getByLabelText("UF")).toHaveValue("SP");
    expect(salvar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "1000" } });
    expect(salvar).toBeEnabled();
    fireEvent.click(salvar);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith("atualizar_endereco_aluno", {
      _aluno_id: "aluno-1",
      _cep: "01310-100",
      _logradouro: "Avenida Paulista",
      _numero: "1000",
      _complemento: "",
      _bairro: "Bela Vista",
      _cidade: "São Paulo",
      _uf: "SP",
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// O interruptor é lido na carga do módulo; cada teste escolhe o estado dele.
async function carregar(ligado: boolean) {
  vi.resetModules();
  vi.stubEnv("VITE_CARTAO_RECORRENTE", ligado ? "true" : "");
  return (await import("./CartaoAssinatura")).CartaoAssinatura;
}

const ASSINATURA_EMITIDA = {
  status: "ativa",
  asaas_subscription_id: "sub_123",
  forma_pagamento: "fatura",
  cartao_final: null,
  cartao_bandeira: null,
  cartao_recusado_em: null,
};

const TITULAR = {
  nome: "Maria Silva",
  email: "maria@exemplo.com",
  cpf: "529.982.247-25",
  telefone: "11987654321",
};

function preencherCartao() {
  fireEvent.change(screen.getByLabelText(/nome impresso/i), { target: { value: "MARIA SILVA" } });
  fireEvent.change(screen.getByLabelText(/número do cartão/i), { target: { value: "4111111111111111" } });
  fireEvent.change(screen.getByLabelText(/^mês$/i), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText(/^ano$/i), { target: { value: "2030" } });
  fireEvent.change(screen.getByLabelText(/cvv/i), { target: { value: "123" } });
  fireEvent.change(screen.getByLabelText(/^cep$/i), { target: { value: "01310100" } });
  fireEvent.change(screen.getByLabelText(/^número$/i), { target: { value: "1000" } });
}

beforeEach(() => invoke.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("CartaoAssinatura", () => {
  it("desligado, mostra a forma de pagamento e não oferece cadastro", async () => {
    const CartaoAssinatura = await carregar(false);
    render(<CartaoAssinatura alunoId="a1" assinatura={ASSINATURA_EMITIDA} />);

    expect(screen.getByText(/fatura mensal/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cartão/i })).not.toBeInTheDocument();
  });

  it("sem cobrança emitida, não oferece cadastro mesmo ligado", async () => {
    const CartaoAssinatura = await carregar(true);
    render(<CartaoAssinatura alunoId="a1" assinatura={{ ...ASSINATURA_EMITIDA, status: "trial", asaas_subscription_id: null }} />);

    expect(screen.getByText(/ainda não emitida/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cartão/i })).not.toBeInTheDocument();
  });

  it("mostra só bandeira e final — nunca mais que isso", async () => {
    const CartaoAssinatura = await carregar(true);
    render(
      <CartaoAssinatura
        alunoId="a1"
        assinatura={{ ...ASSINATURA_EMITIDA, forma_pagamento: "cartao", cartao_final: "1111", cartao_bandeira: "visa" }}
      />
    );
    expect(screen.getByText(/visa final/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trocar cartão/i })).toBeInTheDocument();
  });

  it("avisa quando o cartão foi recusado", async () => {
    const CartaoAssinatura = await carregar(true);
    render(<CartaoAssinatura alunoId="a1" assinatura={{ ...ASSINATURA_EMITIDA, cartao_recusado_em: "2026-09-21T10:00:00Z" }} />);
    expect(screen.getByText(/recusado na última cobrança/i)).toBeInTheDocument();
  });

  it("não chama o servidor com dado inválido", async () => {
    const CartaoAssinatura = await carregar(true);
    render(<CartaoAssinatura alunoId="a1" assinatura={ASSINATURA_EMITIDA} titularPadrao={TITULAR} />);
    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));
    preencherCartao();
    fireEvent.change(screen.getByLabelText(/número do cartão/i), { target: { value: "4111111111111112" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar cartão/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/número do cartão inválido/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("envia o cartão e apaga o que foi digitado depois de salvar", async () => {
    invoke.mockResolvedValue({ data: { cartao_final: "1111", cartao_bandeira: "visa" }, error: null });
    const onSucesso = vi.fn();
    const onSalvo = vi.fn();
    const CartaoAssinatura = await carregar(true);
    render(
      <CartaoAssinatura alunoId="a1" assinatura={ASSINATURA_EMITIDA} titularPadrao={TITULAR} onSucesso={onSucesso} onSalvo={onSalvo} />
    );

    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));
    preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /salvar cartão/i }));

    await waitFor(() => expect(onSalvo).toHaveBeenCalled());
    const [nome, opcoes] = invoke.mock.calls[0];
    expect(nome).toBe("asaas-cartao-assinatura");
    expect(opcoes.body.aluno_id).toBe("a1");
    expect(opcoes.body.titular.numero_endereco).toBe("1000");
    expect(onSucesso.mock.calls[0][0]).toMatch(/final 1111/);

    // Reabrindo, o formulário está vazio: o número não sobreviveu ao salvar.
    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));
    expect(screen.getByLabelText(/número do cartão/i)).toHaveValue("");
    expect(screen.getByLabelText(/cvv/i)).toHaveValue("");
  });

  it("cancelar também apaga o que foi digitado", async () => {
    const CartaoAssinatura = await carregar(true);
    render(<CartaoAssinatura alunoId="a1" assinatura={ASSINATURA_EMITIDA} titularPadrao={TITULAR} />);

    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));
    preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));

    expect(screen.getByLabelText(/número do cartão/i)).toHaveValue("");
  });

  it("mostra a mensagem do servidor quando o cartão é recusado", async () => {
    invoke.mockResolvedValue({
      data: { error: "Cartão não aceito. Confira os dados ou use outro cartão." },
      error: null,
    });
    const CartaoAssinatura = await carregar(true);
    render(<CartaoAssinatura alunoId="a1" assinatura={ASSINATURA_EMITIDA} titularPadrao={TITULAR} />);

    fireEvent.click(screen.getByRole("button", { name: /pagar automático/i }));
    preencherCartao();
    fireEvent.click(screen.getByRole("button", { name: /salvar cartão/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cartão não aceito/i);
  });
});

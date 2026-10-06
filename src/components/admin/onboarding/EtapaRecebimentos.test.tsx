import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EtapaRecebimentos } from "./EtapaRecebimentos";
import { TERMOS_ASAAS_URL, TEXTO_PRESTADOR } from "@/lib/prestadorPagamentos";

/**
 * A etapa Recebimentos com o interruptor da subconta pela ArkeFit (BaaS):
 * desligado, só a conta própria (menos em trial, o sandbox); com o caminho
 * aberto, o aceite dos Termos do Asaas antes de abrir; a recusa do Asaas na
 * tela; os documentos pelo link do Asaas; e o selo do prestador sempre.
 */
let conta: Record<string, unknown> = {};
let subcontasLigadas = false;
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: conta, error: null }) }) }),
      update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: "org-1" }], error: null }) }) }),
    }),
    rpc: () => Promise.resolve({ data: subcontasLigadas, error: null }),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ organization: { id: "org-1" }, organizationRole: "gestor" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const SEM_CONTA = { status: "ativa", asaas_wallet_id: null, asaas_conta_origem: null, asaas_conta_status: null, email_contato: "a@b.c", faturamento_mensal: 30000 };

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EtapaRecebimentos onSalvo={() => {}} />
    </QueryClientProvider>,
  );

describe("EtapaRecebimentos", () => {
  beforeEach(() => {
    conta = { ...SEM_CONTA };
    subcontasLigadas = false;
    invoke.mockReset();
  });

  it("com o interruptor desligado, a conta própria é o único caminho, e o prestador aparece", async () => {
    montar();
    await screen.findByLabelText("Wallet ID da sua conta Asaas");
    expect(screen.queryByText("Abrir pela ArkeFit")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText(TEXTO_PRESTADOR)).toBeInTheDocument();
  });

  it("desligado, a organização em trial (sandbox) vê o caminho, para a homologação", async () => {
    conta = { ...SEM_CONTA, status: "trial" };
    montar();
    expect(await screen.findByText("Abrir pela ArkeFit")).toBeInTheDocument();
  });

  it("ligado, abrir pede o aceite dos Termos do Asaas, e o pedido leva o aceite e o endereço", async () => {
    subcontasLigadas = true;
    invoke.mockResolvedValue({ data: { ok: true, email: "a@b.c" }, error: null });
    montar();
    fireEvent.click(await screen.findByText("Abrir pela ArkeFit"));
    expect(screen.getByText("Quem abre e mantém a conta")).toBeInTheDocument();
    expect(screen.getByText(/A conta de pagamento é aberta e mantida pelo Asaas, em nome da academia/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Termos de Uso do Asaas" })).toHaveAttribute("href", TERMOS_ASAAS_URL);
    const abrir = screen.getByRole("button", { name: "Abrir conta no Asaas" });
    expect(abrir).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(abrir).toBeEnabled();
    fireEvent.click(abrir);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("asaas-conta-academia", {
        body: { organization_id: "org-1", acao: "criar", aceite_termos: true, termos_url: TERMOS_ASAAS_URL },
      }),
    );
  });

  it("a recusa do Asaas (o sandbox recusa subconta) fica na tela, com a conta própria ao lado", async () => {
    conta = { ...SEM_CONTA, status: "trial" };
    invoke.mockResolvedValue({ data: null, error: new Error("Asaas: Não é permitido criar subcontas.") });
    montar();
    fireEvent.click(await screen.findByText("Abrir pela ArkeFit"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Abrir conta no Asaas" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("O Asaas não abriu a conta.");
    expect(alerta).toHaveTextContent("Não é permitido criar subcontas.");
    fireEvent.click(screen.getByRole("button", { name: "informar a carteira" }));
    expect(screen.getByLabelText("Wallet ID da sua conta Asaas")).toBeInTheDocument();
  });

  it("com a conta aberta pela ArkeFit e o caminho BaaS, os documentos aparecem com o link do Asaas", async () => {
    subcontasLigadas = true;
    conta = { ...SEM_CONTA, asaas_wallet_id: "w-1", asaas_conta_origem: "criada", asaas_conta_status: "PENDING" };
    invoke.mockResolvedValue({
      data: {
        ok: true,
        grupos: [
          { id: "g1", status: "NOT_SENT", tipo: "IDENTIFICATION", titulo: "Documento de identidade", descricao: null, responsavel: "Sócio", link: "https://cadastro.io/x", linkExpiraEm: null },
          { id: "g2", status: "APPROVED", tipo: "SOCIAL_CONTRACT", titulo: "Contrato social", descricao: null, responsavel: null, link: null, linkExpiraEm: null },
        ],
        motivo_recusa: null,
      },
      error: null,
    });
    montar();
    expect(await screen.findByText("Documento de identidade")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("asaas-conta-academia", { body: { organization_id: "org-1", acao: "documentos" } });
    const enviar = screen.getByRole("link", { name: /Enviar no Asaas/ });
    expect(enviar).toHaveAttribute("href", "https://cadastro.io/x");
    expect(enviar).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText(TEXTO_PRESTADOR)).toBeInTheDocument();
  });

  it("com a subconta antiga e o interruptor desligado, segue o caminho de hoje (o e-mail do Asaas)", async () => {
    conta = { ...SEM_CONTA, asaas_wallet_id: "w-1", asaas_conta_origem: "criada", asaas_conta_status: "PENDING" };
    montar();
    expect(await screen.findByText(/Próximo passo, no e-mail do Asaas/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});

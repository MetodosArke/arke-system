import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotasFiscaisPainel } from "./NotasFiscaisPainel";

const invoke = vi.fn();
const rpc = vi.fn();
let papel = "gestor";
let tabelas: Record<string, unknown[]> = {};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const resposta = () => Promise.resolve({ data: tabelas[tabela] ?? [], error: null });
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        order: () => consulta,
        in: resposta,
        limit: resposta,
      };
      return consulta;
    },
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ organization: { id: "org-1" }, organizationRole: papel }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const conectada = (x: Record<string, unknown> = {}) => ({
  conectada: true,
  cidade: "São Paulo",
  uf: "SP",
  opcoes: {
    authenticationType: "USER_AND_PASSWORD",
    supportsCancellation: true,
    usesSpecialTaxRegimes: false,
    usesServiceListItem: false,
    specialTaxRegimesList: [],
    nationalPortalTaxCalculationRegimeList: [],
    municipalInscriptionHelp: null,
    specialTaxRegimeHelp: null,
    serviceListItemHelp: null,
    digitalCertificatedHelp: null,
    accessTokenHelp: null,
    nationalPortalTaxCalculationRegimeHelp: null,
  },
  cadastro: null,
  config: null,
  pronta: false,
  ...x,
});
const acao = (n: number) => {
  const corpo = invoke.mock.calls[n][1].body;
  return corpo instanceof FormData ? corpo.get("acao") : corpo.acao;
};

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NotasFiscaisPainel />
    </QueryClientProvider>,
  );

describe("NotasFiscaisPainel", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    papel = "gestor";
    tabelas = {};
  });

  it("academia com conta própria e sem chave: pede a chave de API", async () => {
    invoke.mockResolvedValueOnce({ data: { conectada: false, possuiCarteira: true }, error: null });
    invoke.mockResolvedValueOnce({ data: conectada(), error: null });
    montar();
    const campo = await screen.findByLabelText("Chave de API do Asaas");
    const conectar = screen.getByRole("button", { name: "Conectar" });
    expect(conectar).toBeDisabled();
    fireEvent.change(campo, { target: { value: "$aact_hmlg_000000000000000000000" } });
    fireEvent.click(conectar);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1].body).toMatchObject({ acao: "chave", organization_id: "org-1", chave: "$aact_hmlg_000000000000000000000" });
    // Conectada, a tela passa ao cadastro na prefeitura.
    expect(await screen.findByText(/Cadastro na prefeitura — São Paulo\/SP/)).toBeInTheDocument();
  });

  it("o formulário pede o que a prefeitura exige, e o envio vai ao Asaas sem certificado", async () => {
    invoke.mockResolvedValue({ data: conectada(), error: null });
    montar();
    await screen.findByLabelText("Usuário do portal da prefeitura");
    // Prefeitura de usuário e senha: nada de certificado nem token.
    expect(screen.queryByLabelText("Certificado digital A1 (.pfx)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Token de acesso da prefeitura")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("E-mail para avisos fiscais"), { target: { value: "fiscal@academia.com.br" } });
    fireEvent.change(screen.getByLabelText("Usuário do portal da prefeitura"), { target: { value: "academia" } });
    fireEvent.change(screen.getByLabelText("Senha do portal da prefeitura"), { target: { value: "segredo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar cadastro" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const f = invoke.mock.calls[1][1].body as FormData;
    expect(f.get("acao")).toBe("cadastro");
    expect(f.get("username")).toBe("academia");
    expect(f.get("password")).toBe("segredo");
    expect(f.get("certificateFile")).toBeNull();
    // A senha sai da tela depois de entregue.
    await waitFor(() => expect(screen.getByLabelText("Senha do portal da prefeitura")).toHaveValue(""));
  });

  it("só liga a emissão quando o Asaas diz que está pronta", async () => {
    const config = { emissao_ativa: false, servico_municipal_id: "srv_1", servico_municipal_codigo: null, servico_municipal_nome: "Ginástica", aliquota_iss: 2, observacoes: null };
    invoke.mockResolvedValueOnce({ data: conectada({ config }), error: null });
    const { unmount } = montar();
    expect(await screen.findByRole("button", { name: "Ligar emissão automática" })).toBeDisabled();
    unmount();

    invoke.mockReset();
    invoke.mockResolvedValueOnce({ data: conectada({ config, pronta: true }), error: null });
    invoke.mockResolvedValueOnce({ data: conectada({ config: { ...config, emissao_ativa: true }, pronta: true }), error: null });
    montar();
    const ligar = await screen.findByRole("button", { name: "Ligar emissão automática" });
    expect(screen.getByLabelText("Alíquota de ISS (%)")).toHaveValue("2,00");
    fireEvent.click(ligar);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(acao(1)).toBe("config");
    expect(invoke.mock.calls[1][1].body).toMatchObject({ emissao_ativa: true, servico_municipal_id: "srv_1", aliquota_iss: 2 });
    expect(await screen.findByRole("button", { name: "Desligar emissão" })).toBeInTheDocument();
  });

  it("a recepção vê as notas e reenvia a que deu erro, sem mexer na configuração", async () => {
    papel = "recepcao";
    tabelas = {
      notas_fiscais: [
        { id: "n1", aluno_id: "a1", origem: "mensalidade", valor: 125.53, descricao: "Mensalidade — Plano Mensal", competencia: "2026-09-24", status: "emitida", numero: "123", pdf_url: "https://asaas/nota.pdf", erro: null },
        { id: "n2", aluno_id: "a1", origem: "avulsa", valor: 38.01, descricao: "Taxa de matrícula", competencia: "2026-09-24", status: "erro", numero: null, pdf_url: null, erro: "Inscrição municipal inválida." },
      ],
      alunos: [{ id: "a1", user_id: "u1" }],
      profiles: [{ user_id: "u1", full_name: "Maria Souza" }],
    };
    rpc.mockResolvedValue({ data: null, error: null });
    montar();
    await waitFor(() => expect(screen.getAllByText(/Maria Souza/)).toHaveLength(2));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /PDF/ })).toHaveAttribute("href", "https://asaas/nota.pdf");
    // O valor é o que entrou no caixa da academia, escrito como no Brasil.
    expect(document.body.textContent).toMatch(/R\$\s125,53/);
    expect(screen.getByText("Inscrição municipal inválida.")).toBeInTheDocument();
    const reenviar = screen.getAllByRole("button", { name: /Tentar de novo/ });
    expect(reenviar).toHaveLength(1);
    fireEvent.click(reenviar[0]);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("reprocessar_nota_fiscal", { _nota_id: "n2" }));
  });
});

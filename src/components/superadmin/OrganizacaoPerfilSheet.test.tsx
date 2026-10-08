import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizacaoPerfilSheet, type OrganizacaoPerfil } from "./OrganizacaoPerfilSheet";

/**
 * A ficha da organização por nível (os níveis da equipe ArkeFit, entrega 2):
 * o dinheiro (mensalidade, taxa, repasse, conta das cobranças) só para o
 * financeiro; o trial, o encerramento e a atividade (que traz saúde), só para
 * o Sócio. O que a pessoa não abre não aparece e não vai ao banco. Os blocos
 * de dentro são substituídos aqui: cada um faz as próprias consultas, e o que
 * se confere é se a ficha os monta.
 */
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const acesso = vi.hoisted(() => ({ atual: { socio: true, niveis: [] as string[] } }));
vi.mock("@/hooks/useAcessoArkefit", async () => {
  const { podeArea } = await vi.importActual<typeof import("@/lib/acessosArkefit")>("@/lib/acessosArkefit");
  return { useAcessoArkefit: () => ({ acesso: acesso.atual, pode: (a: Parameters<typeof podeArea>[1]) => podeArea(acesso.atual, a) }) };
});

vi.mock("@/components/superadmin/MensalidadeB2bOrganizacao", () => ({ MensalidadeB2bOrganizacao: () => <p>bloco-mensalidade</p> }));
vi.mock("@/components/superadmin/TaxaImplantacaoOrganizacao", () => ({ TaxaImplantacaoOrganizacao: () => <p>bloco-taxa</p> }));
vi.mock("@/components/superadmin/RepasseOrganizacao", () => ({ RepasseOrganizacao: () => <p>bloco-repasse</p> }));
vi.mock("@/components/superadmin/CobrancaContaAcademiaOrganizacao", () => ({ CobrancaContaAcademiaOrganizacao: () => <p>bloco-conta</p> }));
vi.mock("@/components/superadmin/TrialAlunosOrganizacao", () => ({ TrialAlunosOrganizacao: () => <p>bloco-trial</p> }));
vi.mock("@/components/superadmin/EncerramentoOrganizacao", () => ({ EncerramentoOrganizacao: () => <p>bloco-encerramento</p> }));

const TENANT: OrganizacaoPerfil = {
  organization_id: "00000000-0000-4000-8000-0000000000a1",
  nome: "Academia Prova",
  slug: "prova",
  status: "ativo",
  plano_b2b: "growth",
  tipo: "academia",
  created_at: "2026-10-01T10:00:00Z",
  alunos_total: 12,
  mrr_organizacao: 1234,
  assinaturas_atrasadas: 2,
  ultima_atividade: null,
  cnpj_cpf: "12.345.678/0001-90",
  telefone: "(11) 3333-4444",
  trial_vencimento: null,
  gestor_email: "gestora@exemplo.com",
};

const renderizar = (props: Partial<Parameters<typeof OrganizacaoPerfilSheet>[0]> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrganizacaoPerfilSheet tenant={TENANT} onOpenChange={() => undefined} {...props} />
    </QueryClientProvider>,
  );
};

const DINHEIRO = ["bloco-mensalidade", "bloco-taxa", "bloco-repasse", "bloco-conta"];
const SOCIO = ["bloco-trial", "bloco-encerramento"];

describe("a ficha da organização por nível", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
    acesso.atual = { socio: true, niveis: [] };
  });

  it("o Comercial vê o cadastro e o contato, sem o dinheiro, o trial e a atividade, e nada vai ao banco", async () => {
    acesso.atual = { socio: false, niveis: ["comercial"] };
    renderizar({ onEditar: () => undefined });
    expect(await screen.findByText("Academia Prova")).toBeInTheDocument();
    expect(screen.getByText("12.345.678/0001-90")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editar Informações/ })).toBeInTheDocument();
    for (const b of [...DINHEIRO, ...SOCIO]) expect(screen.queryByText(b)).not.toBeInTheDocument();
    expect(screen.queryByText(/MRR/)).not.toBeInTheDocument();
    expect(screen.queryByText("Atividade Recente")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Financeiro vê o MRR e os quatro blocos do dinheiro, sem o trial e a atividade", async () => {
    acesso.atual = { socio: false, niveis: ["financeiro"] };
    renderizar({ onFaturamento: () => undefined });
    expect(await screen.findByText("bloco-mensalidade")).toBeInTheDocument();
    for (const b of DINHEIRO) expect(screen.getByText(b)).toBeInTheDocument();
    expect(screen.getByText(/MRR/)).toBeInTheDocument();
    expect(screen.getByText(/2 assinatura\(s\) atrasada\(s\)/)).toBeInTheDocument();
    for (const b of SOCIO) expect(screen.queryByText(b)).not.toBeInTheDocument();
    expect(screen.queryByText("Atividade Recente")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Sócio vê tudo, e a atividade vai ao banco", async () => {
    renderizar();
    for (const b of [...DINHEIRO, ...SOCIO]) expect(await screen.findByText(b)).toBeInTheDocument();
    expect(screen.getByText("Atividade Recente")).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_superadmin_organizacao_atividade", { _organization_id: TENANT.organization_id }));
  });
});

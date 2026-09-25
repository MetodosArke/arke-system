import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PagamentosAcademia, prazo } from "./PagamentosAcademia";

type Linha = { id: string; vencimento: string; valor: number; status: string; invoice_url: string | null; descricao?: string };
type Nota = { origem_id: string; pdf_url: string };
type Matricula = { status: string; asaas_subscription_id: string | null; forma_pagamento: string; cartao_final: string | null; cartao_bandeira: string | null; cartao_recusado_em: string | null };
const tabelas: Record<string, (Linha | Nota | Matricula)[]> = { mensalidades: [], cobrancas_avulsas: [], notas_fiscais: [], aluno_matriculas_academia: [] };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        not: () => consulta,
        order: () => consulta,
        limit: () => Object.assign(Promise.resolve({ data: tabelas[tabela], error: null }), {
          maybeSingle: () => Promise.resolve({ data: tabelas[tabela][0] ?? null, error: null }),
        }),
      };
      return consulta;
    },
  },
}));
vi.mock("@/lib/dataBrasilia", () => ({ hojeBrasilia: () => "2026-09-24" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { full_name: "Aluna" }, user: { email: "aluna@teste.com" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const linha = (x: Partial<Linha>): Linha => ({
  id: x.id ?? "m1",
  vencimento: "2026-09-24",
  valor: 129.9,
  status: "pendente",
  invoice_url: "https://www.asaas.com/i/abc",
  ...x,
});

const montar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PagamentosAcademia alunoId="aluno-1" />
    </QueryClientProvider>,
  );

describe("PagamentosAcademia", () => {
  beforeEach(() => {
    tabelas.mensalidades = [];
    tabelas.cobrancas_avulsas = [];
    tabelas.notas_fiscais = [];
    tabelas.aluno_matriculas_academia = [];
  });

  it("não aparece para quem não tem nada cobrado pelo ARKE", async () => {
    const { container } = montar();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra mensalidade e cobrança avulsa em aberto, cada uma com o link da fatura", async () => {
    tabelas.mensalidades = [
      linha({ id: "a", vencimento: "2026-09-24" }),
      linha({ id: "b", vencimento: "2026-08-24", status: "confirmado", invoice_url: null }),
      linha({ id: "c", vencimento: "2026-07-24", status: "cancelado" }),
    ];
    tabelas.cobrancas_avulsas = [
      linha({ id: "d", descricao: "Taxa de matrícula", valor: 80, vencimento: "2026-09-20", invoice_url: "https://www.asaas.com/i/taxa" }),
    ];
    montar();
    await waitFor(() => expect(screen.getByText("Vence hoje")).toBeInTheDocument());
    const links = screen.getAllByRole("link", { name: /Pagar/ }).map((l) => l.getAttribute("href"));
    // A vencida primeiro: é a que o aluno precisa resolver antes.
    expect(links).toEqual(["https://www.asaas.com/i/taxa", "https://www.asaas.com/i/abc"]);
    expect(screen.getByText("Venceu em 20/09/2026")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Taxa de matrícula");
    expect(screen.getByText("Paga")).toBeInTheDocument();
    // Cancelada não é dívida nem pagamento: não aparece.
    expect(document.body.textContent).not.toContain("24/07/2026");
  });

  it("põe o link da nota fiscal ao lado do pagamento que a academia já emitiu", async () => {
    tabelas.mensalidades = [linha({ id: "paga-com-nota", status: "confirmado" }), linha({ id: "paga-sem-nota", vencimento: "2026-08-24", status: "confirmado" })];
    tabelas.notas_fiscais = [{ origem_id: "paga-com-nota", pdf_url: "https://www.asaas.com/nota/1" }];
    montar();
    await waitFor(() => expect(screen.getAllByText("Paga")).toHaveLength(2));
    expect(screen.getAllByRole("link", { name: "Nota fiscal" }).map((l) => l.getAttribute("href"))).toEqual(["https://www.asaas.com/nota/1"]);
  });

  it("com a mensalidade cobrada pelo ARKE, mostra a forma de pagamento dela", async () => {
    tabelas.aluno_matriculas_academia = [
      { status: "ativa", asaas_subscription_id: "sub_1", forma_pagamento: "cartao", cartao_final: "4242", cartao_bandeira: "visa", cartao_recusado_em: null },
    ];
    montar();
    expect(await screen.findByText("4242")).toBeInTheDocument();
    expect(document.body.textContent).toContain("cobrança automática");
  });

  it("diz quando não há nada em aberto", async () => {
    tabelas.mensalidades = [linha({ status: "confirmado" })];
    montar();
    await waitFor(() => expect(screen.getByText("Nada em aberto.")).toBeInTheDocument());
  });
});

describe("prazo", () => {
  it("fala em vencimento futuro, de hoje e passado", () => {
    expect(prazo({ vencimento: "2026-10-01", status: "pendente" }, "2026-09-24")).toBe("Vence em 01/10/2026");
    expect(prazo({ vencimento: "2026-09-24", status: "pendente" }, "2026-09-24")).toBe("Vence hoje");
    // Pendente com data passada é o webhook de atraso que ainda não chegou.
    expect(prazo({ vencimento: "2026-09-20", status: "pendente" }, "2026-09-24")).toBe("Venceu em 20/09/2026");
    expect(prazo({ vencimento: "2026-09-24", status: "atrasado" }, "2026-09-24")).toBe("Venceu em 24/09/2026");
  });
});

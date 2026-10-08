import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuperAdminComercial from "./SuperAdminComercial";

/**
 * O Pipeline por nível (os níveis da equipe ArkeFit, entrega 2): o Comercial
 * trabalha o quadro e aciona a Letícia nos cartões; ligar e desligar a
 * Letícia (o painel da resposta automática) é do Sócio, e não aparece nem vai
 * ao banco para o Comercial. O quadro, o formulário e o painel da Letícia são
 * substituídos aqui: o que se confere é o que a página monta e consulta.
 */
const tabelas = vi.fn();
const rpc = vi.fn();
const DADOS: Record<string, unknown[]> = {
  leads_comerciais: [{ id: "l1", academia: "Academia do WhatsApp", origem: "whatsapp", status: "novo", status_desde: "2026-10-08T10:00:00Z" }],
  plataforma_config: [{ chave: "agente_comercial_ativo", valor: 1 }],
  plataforma_textos: [],
};
const consulta = (tabela: string) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "or", "order", "in", "range", "eq"]) q[m] = () => q;
  q.then = (ok: (r: unknown) => unknown) => ok({ data: DADOS[tabela] ?? [], error: null });
  return q;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (tabela: string) => {
      tabelas(tabela);
      return consulta(tabela);
    },
  },
}));

const acesso = vi.hoisted(() => ({ atual: { socio: true, niveis: [] as string[] } }));
vi.mock("@/hooks/useAcessoArkefit", async () => {
  const { podeArea } = await vi.importActual<typeof import("@/lib/acessosArkefit")>("@/lib/acessosArkefit");
  return { useAcessoArkefit: () => ({ acesso: acesso.atual, pode: (a: Parameters<typeof podeArea>[1]) => podeArea(acesso.atual, a) }) };
});

vi.mock("@/components/superadmin/RespostaAutomatica", () => ({ RespostaAutomatica: () => <p>painel-da-leticia</p> }));
vi.mock("@/components/superadmin/comercial/QuadroPipeline", () => ({
  QuadroPipeline: ({ leads, cfg }: { leads: { academia: string }[]; cfg: { ativo: boolean } }) => (
    <div>
      <p>quadro: {leads.map((l) => l.academia).join(", ")}</p>
      <p>letícia {cfg.ativo ? "ligada" : "desligada"}</p>
    </div>
  ),
}));
vi.mock("@/components/superadmin/comercial/FormularioLead", () => ({ FormularioLead: () => null }));
vi.mock("@/components/superadmin/comercial/DialogoPerda", () => ({ DialogoPerda: () => null }));

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SuperAdminComercial />
    </QueryClientProvider>,
  );
};

describe("o Pipeline por nível", () => {
  beforeEach(() => {
    tabelas.mockReset();
    rpc.mockReset();
    acesso.atual = { socio: true, niveis: [] };
  });

  it("o Comercial trabalha o quadro e lê os interruptores da Letícia, sem o painel de ligar e desligar", async () => {
    acesso.atual = { socio: false, niveis: ["comercial"] };
    renderizar();
    expect(await screen.findByText("quadro: Academia do WhatsApp")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("letícia ligada")).toBeInTheDocument());
    expect(screen.queryByText("painel-da-leticia")).not.toBeInTheDocument();
    expect(tabelas.mock.calls.map((c) => c[0]).sort()).toEqual(["leads_comerciais", "plataforma_config", "plataforma_textos"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Sócio vê o painel da Letícia", async () => {
    renderizar();
    expect(await screen.findByText("painel-da-leticia")).toBeInTheDocument();
    expect(await screen.findByText("quadro: Academia do WhatsApp")).toBeInTheDocument();
  });
});

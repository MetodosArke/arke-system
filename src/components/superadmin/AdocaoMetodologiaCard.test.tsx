import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdocaoMetodologiaCard } from "./AdocaoMetodologiaCard";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const LINHA_BASE = {
  organization_id: "org-1",
  nome: "Tietê Fitness",
  status: "ativo",
  plano_b2b: "growth",
  alunos_total: 2,
  alunos_metodo_arke: 0,
  anamnese_concluida: 1,
  anamnese_pct: 50,
  com_treino_ativo: 1,
  treino_pct: 50,
  nutricao_contratada: 0,
  com_dieta_ativa: 0,
  nutricao_pct: null,
  checkin_30d: 0,
  checkin_pct: 0,
  tarefas_concluidas_30d: 0,
  tarefas_com_desfecho_30d: 0,
  desfecho_pct: null,
  tarefas_vencidas_abertas: 0,
  score_adocao: 33.3,
};

const renderizar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdocaoMetodologiaCard />
    </QueryClientProvider>
  );
};

describe("AdocaoMetodologiaCard", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("mostra o score e a cobertura de cada pilar", async () => {
    rpc.mockResolvedValue({ data: [LINHA_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Tietê Fitness")).toBeInTheDocument());
    expect(screen.getByText("33")).toBeInTheDocument();
    expect(screen.getByText("1/2 concluíram")).toBeInTheDocument();
    expect(screen.getByText("1/2 com ficha ativa")).toBeInTheDocument();
    expect(screen.getByText("0/2 nos últimos 30d")).toBeInTheDocument();
  });

  it("mostra 'não contratada' em vez de 0% quando o pilar não se aplica", async () => {
    rpc.mockResolvedValue({ data: [LINHA_BASE], error: null });

    renderizar();

    await waitFor(() => expect(screen.getByText("Nutrição")).toBeInTheDocument());
    // O ponto central: nutrição não contratada não pode aparecer como 0%,
    // que passaria a impressão de que a academia deixou de prescrever.
    expect(screen.getByText("não contratada")).toBeInTheDocument();
  });

  it("trata academia sem alunos como '—', não como score zero", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ...LINHA_BASE,
          organization_id: "org-2",
          nome: "Teste Jean",
          alunos_total: 0,
          anamnese_concluida: 0,
          anamnese_pct: null,
          com_treino_ativo: 0,
          treino_pct: null,
          checkin_30d: 0,
          checkin_pct: null,
          score_adocao: null,
        },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Teste Jean")).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("sem alunos")).toBeInTheDocument();
    expect(screen.getByText("1 sem aluno cadastrado")).toBeInTheDocument();
    // Sem alunos, as barras de pilar nem aparecem.
    expect(screen.queryByText("Anamnese (M.A.P.A.)")).not.toBeInTheDocument();
  });

  it("conta como em risco só quem tem aluno e score abaixo do limite", async () => {
    rpc.mockResolvedValue({
      data: [
        { ...LINHA_BASE, organization_id: "a", nome: "Em risco", score_adocao: 20 },
        { ...LINHA_BASE, organization_id: "b", nome: "Saudável", score_adocao: 90 },
        // Sem alunos não é "em risco": é uma academia que ainda não começou.
        { ...LINHA_BASE, organization_id: "c", nome: "Vazia", alunos_total: 0, score_adocao: null },
      ],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("1 academia em risco")).toBeInTheDocument());
    expect(screen.getByText("1 sem aluno cadastrado")).toBeInTheDocument();
  });

  it("mostra tarefas com prazo vencido quando existem", async () => {
    rpc.mockResolvedValue({
      data: [{ ...LINHA_BASE, tarefas_vencidas_abertas: 3 }],
      error: null,
    });

    renderizar();

    await waitFor(() => expect(screen.getByText("Tietê Fitness")).toBeInTheDocument());
    expect(document.body.textContent).toContain("3 tarefa(s) com prazo vencido");
  });

  it("exibe o erro quando a RPC é negada para quem não é superadmin", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Acesso restrito ao Super Admin ArkeFit.") });

    renderizar();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Acesso restrito ao Super Admin ArkeFit.")
    );
  });
});

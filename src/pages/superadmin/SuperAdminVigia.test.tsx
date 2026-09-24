import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import SuperAdminVigia from "./SuperAdminVigia";
import type { ResumoVigia } from "@/lib/vigia";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

// Formato de public.get_superadmin_vigia().
const RESUMO: ResumoVigia = {
  ativo: true,
  sombra_desde: "2026-09-24T12:00:00Z",
  dia: 3,
  dias_avaliacao: 14,
  janela_horas: 24,
  varreduras: 288,
  regras: [
    {
      codigo: "gateway_sincronizacao_atrasada",
      nivel: 1,
      titulo: "Gateway com a lista de alunos atrasada",
      acao: "Pedir ao Gateway a sincronização completa",
      modo: "sombra",
      deteccoes: 2,
      teria_agido: 1,
      com_retentativa: 0,
      sumiram_antes: 1,
      mediana_min_sumiram: 3.5,
      persistiram: 1,
      escalariam: 0,
      freios: 0,
      abertas: 1,
    },
  ],
  ocorrencias: [
    {
      id: 7,
      regra: "gateway_sincronizacao_atrasada",
      nivel: 1,
      titulo: "Gateway com a lista de alunos atrasada",
      descricao: "Recepção (Tietê Fitness): lista de alunos sincronizada há 34 min",
      aberta_em: new Date(Date.now() - 20 * 60_000).toISOString(),
      fechada_em: null,
      acao_prevista_em: new Date(Date.now() - 15 * 60_000).toISOString(),
      tentativas_previstas: 1,
      escalaria_em: null,
      freio_em: null,
    },
  ],
  analises: {
    total: 1,
    ok: 1,
    indisponiveis: 0,
    recusadas: 0,
    invalidas: 0,
    acoes_sozinho: 1,
    acoes_aprovacao: 0,
    acoes_humano: 1,
    acoes_recusadas: 1,
    lista: [
      {
        id: 3,
        criada_em: "2026-09-26T13:10:00Z",
        status: "ok",
        modelo: "global.anthropic.claude-sonnet-4-6",
        diagnostico: "Recepção e Sala 2 da Tietê Fitness caíram juntas: rede local.",
        causa_provavel: "internet_da_academia",
        gravidade: "alta",
        confianca: 85,
        anomalias: 2,
        latencia_ms: 9000,
        motivo: null,
        acoes: [
          { ferramenta: "acionar_academia", alvo: "A1", alvo_nome: "Tietê Fitness", justificativa: "Duas caíram juntas.", classe: "humano" },
          { ferramenta: "liberar_catraca", alvo: "G1", alvo_nome: "Recepção (Tietê Fitness)", justificativa: "", classe: null, recusada: "fora_do_catalogo" },
        ],
      },
    ],
  },
  total: { deteccoes: 5, teria_agido: 3, sumiram_antes: 2, escalariam: 0, analises: 4 },
};

const montar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SuperAdminVigia />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("Visão Master → Vigia", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation((nome: string) =>
      Promise.resolve(nome === "get_superadmin_vigia" ? { data: RESUMO, error: null } : { data: null, error: null }),
    );
  });

  it("mostra o período, as regras, a análise e as ocorrências", async () => {
    montar();
    expect(await screen.findByText("Dia 3 de 14 da avaliação")).toBeInTheDocument();
    expect(screen.getByText("Nada é executado no modo sombra.")).toBeInTheDocument();
    expect(screen.getAllByText("Gateway com a lista de alunos atrasada").length).toBeGreaterThan(0);
    expect(screen.getByText("mediana 3,5 min")).toBeInTheDocument();
    expect(screen.getByText("Recepção e Sala 2 da Tietê Fitness caíram juntas: rede local.")).toBeInTheDocument();
    expect(screen.getByText("Internet da academia")).toBeInTheDocument();
    expect(screen.getByText("pede uma pessoa")).toBeInTheDocument();
    expect(screen.getByText("recusada: fora da lista de ferramentas")).toBeInTheDocument();
    expect(screen.getByText("teria agido")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("get_superadmin_vigia", { _horas: 24 });
  });

  it("desligar chama o interruptor do banco", async () => {
    montar();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("definir_vigia_ativo", { _ativo: false }));
  });

  it("erro de leitura aparece como erro, não como tela vazia", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Acesso restrito à ArkeFit." } });
    montar();
    expect(await screen.findByText("Não foi possível carregar o Vigia.")).toBeInTheDocument();
  });
});

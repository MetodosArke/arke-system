import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import SuperAdminVigia from "./SuperAdminVigia";
import type { ResumoVigia } from "@/lib/vigia";

const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

// Formato de public.get_superadmin_vigia().
const base = (modo: "sombra" | "automatica"): ResumoVigia => ({
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
      modo,
      ferramenta: "sincronizar_gateway",
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
    {
      codigo: "assinatura_orfa",
      nivel: 2,
      titulo: "Assinatura cobrando no Asaas sem registro no banco",
      acao: "Cancelar a assinatura no Asaas, com aprovação",
      modo: modo === "sombra" ? "sombra" : "aprovacao",
      ferramenta: "cancelar_assinatura_orfa",
      deteccoes: 1,
      teria_agido: 1,
      com_retentativa: 0,
      sumiram_antes: 0,
      mediana_min_sumiram: null,
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
      modo,
      decisao: null,
      aberta_em: new Date(Date.now() - 20 * 60_000).toISOString(),
      fechada_em: null,
      acao_prevista_em: new Date(Date.now() - 15 * 60_000).toISOString(),
      tentativas_previstas: 1,
      escalaria_em: null,
      freio_em: null,
    },
  ],
  pendentes:
    modo === "sombra"
      ? []
      : [
          {
            origem: "regra",
            id: 9,
            indice: null,
            desde: new Date(Date.now() - 5 * 60_000).toISOString(),
            ferramenta: "cancelar_assinatura_orfa",
            alvo_nome: "Assinatura ativa no Asaas sem registro no banco (metodo:x)",
            descricao: "Assinatura ativa no Asaas sem registro no banco (metodo:x)",
            titulo: "Assinatura cobrando no Asaas sem registro no banco",
          },
        ],
  executadas: {
    automaticas: modo === "sombra" ? 0 : 1,
    aprovadas: 0,
    dispensadas: 0,
    erros: 0,
    lista:
      modo === "sombra"
        ? []
        : [
            {
              id: 1,
              criada_em: new Date(Date.now() - 15 * 60_000).toISOString(),
              origem: "regra",
              ferramenta: "sincronizar_gateway",
              alvo_nome: "Recepção (Tietê Fitness)",
              forma: "automatica",
              resultado: "ok",
              detalhe: "Ordem na fila do Gateway.",
              decidido_por: null,
              comando_status: "concluido",
              comando_erro: null,
            },
          ],
  },
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
          {
            ferramenta: "reenviar_acessos_gateway",
            alvo: "G1",
            alvo_nome: "Recepção (Tietê Fitness)",
            justificativa: "",
            classe: null,
            recusada: "alvo_sem_sinal",
          },
        ],
      },
    ],
  },
  total: { deteccoes: 5, teria_agido: 3, sumiram_antes: 2, escalariam: 0, analises: 4, executadas: 1 },
});

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

const servir = (resumo: ResumoVigia) =>
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(nome === "get_superadmin_vigia" ? { data: resumo, error: null } : { data: null, error: null }),
  );

describe("Visão Master → Vigia", () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it("em modo sombra: período, regras, análise e ocorrências", async () => {
    servir(base("sombra"));
    montar();
    expect(await screen.findByText("Dia 3 de 14 da avaliação")).toBeInTheDocument();
    expect(screen.getByText("Nada é executado no modo sombra.")).toBeInTheDocument();
    expect(screen.getByText("Modo sombra")).toBeInTheDocument();
    expect(screen.getByText("mediana 3,5 min")).toBeInTheDocument();
    expect(screen.getByText("Recepção e Sala 2 da Tietê Fitness caíram juntas: rede local.")).toBeInTheDocument();
    expect(screen.getByText("recusada: Gateway sem sinal, a ordem não chegaria")).toBeInTheDocument();
    expect(screen.getByText("teria agido")).toBeInTheDocument();
    expect(screen.queryByText("Aguardando aprovação")).not.toBeInTheDocument();
  });

  it("executando: mostra o que espera aprovação e o que o Vigia fez", async () => {
    servir(base("automatica"));
    montar();
    expect(await screen.findByText("Executando")).toBeInTheDocument();
    expect(screen.getByText("Aguardando aprovação")).toBeInTheDocument();
    expect(screen.getByText("Cancelar assinatura órfã")).toBeInTheDocument();
    expect(screen.getByText("O que o Vigia fez")).toBeInTheDocument();
    expect(screen.getByText("ordem concluido")).toBeInTheDocument();
    expect(screen.getByText("agiu")).toBeInTheDocument();
  });

  it("aprovar chama a função que reserva a decisão e executa", async () => {
    servir(base("automatica"));
    invoke.mockResolvedValue({ data: { ok: true, detalhe: "Assinatura cancelada no Asaas." }, error: null });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("vigia-aprovar", { body: { origem: "regra", id: 9, indice: null } }),
    );
  });

  it("dispensar pede o motivo e registra a decisão", async () => {
    servir(base("automatica"));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Dispensar" }));
    fireEvent.change(await screen.findByLabelText("Motivo (opcional)"), { target: { value: "já resolvido à mão" } });
    const botoes = screen.getAllByRole("button", { name: "Dispensar" });
    fireEvent.click(botoes[botoes.length - 1]);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("vigia_dispensar", { _origem: "regra", _id: 9, _indice: undefined, _motivo: "já resolvido à mão" }),
    );
  });

  it("desligar chama o interruptor do banco", async () => {
    servir(base("automatica"));
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

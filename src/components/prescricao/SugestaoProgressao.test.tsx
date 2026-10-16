import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { diaBrasilia } from "@/lib/dataBrasilia";
import { SugestaoProgressao } from "./SugestaoProgressao";

let papel: string | null = "professor";
let tabelas: Record<string, unknown> = {};
let falhar = false;
let consultadas: string[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      consultadas.push(tabela);
      const resposta = () => (falhar ? { data: null, error: { message: "falhou" } } : { data: tabelas[tabela] ?? null, error: null });
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        gte: () => consulta,
        order: () => consulta,
        limit: () => consulta,
        maybeSingle: () => Promise.resolve(resposta()),
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, erro),
      };
      return consulta;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-1" }, organization: { id: "org-1", tipo: "academia", especialidadeProfissional: null }, organizationRole: papel }),
}));

const series = (carga: number) =>
  [1, 2, 3].map((n) => ({ exercicio_id: "ex-supino", exercicio_ordem: 0, serie_numero: n, carga_kg: carga, repeticoes: 12, concluida: true }));

/** Um aluno do Free com dois treinos no topo da faixa, com folga: o caso de subir. */
function alunoNoTopo(o: { metodo?: boolean; sensacao?: string; suspensa?: boolean } = {}) {
  tabelas = {
    treinos: {
      id: "treino-1",
      snapshot_conteudo: [
        { ordem: 0, divisao: "A", nome_exercicio: "Supino reto", exercicio_id: "ex-supino", equipamento: "Barra", series: 3, repeticoes: "8-12", descanso_seg: 60 },
        { ordem: 1, divisao: "A", nome_exercicio: "Prancha", exercicio_id: "ex-prancha", equipamento: "Peso Corporal", series: 3, repeticoes: "30-45s", descanso_seg: 45 },
      ],
    },
    registro_treino: [
      // As respostas do fim do treino vêm do bem-estar, embutido (20261452010000).
      { data: diaBrasilia(-6), treino_id: "treino-1", registro_serie: series(40), registro_treino_bem_estar: { esforco_percebido: 6, sensacao: "bom", sono: 4, energia: 4 } },
      {
        data: diaBrasilia(-2),
        treino_id: "treino-1",
        registro_serie: series(40),
        registro_treino_bem_estar: { esforco_percebido: 6, sensacao: o.sensacao ?? "bom", sono: null, energia: null },
      },
    ],
    alunos: { metodo_arke_status: o.metodo ? "ativo" : "inativo" },
    aluno_progressao_bloqueada: o.suspensa ? { bloqueada_em: "2026-10-01T12:00:00Z" } : null,
    anamnese_acolhimento: { consentimento_lgpd_revogado_em: null },
    checkins: [],
  };
}

const montar = (escopo: "academia" | "metodo" = "academia") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SugestaoProgressao alunoId="aluno-1" escopo={escopo} />
    </QueryClientProvider>,
  );

describe("SugestaoProgressao", () => {
  beforeEach(() => {
    papel = "professor";
    falhar = false;
    consultadas = [];
    alunoNoTopo();
  });

  it("o professor vê a sugestão do aluno do Free, deixando claro que a decisão é dele", async () => {
    montar();
    expect(screen.getByRole("status")).toHaveTextContent("Calculando a sugestão de progressão");
    expect(await screen.findByText("Pode subir a carga: completou o topo da faixa com folga em 2 treinos.")).toBeInTheDocument();
    expect(screen.getByText("Referência: cerca de +2,5 kg (de 40 para 42,5 kg).")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sugestão de progressão da carga" })).toBeInTheDocument();
    expect(screen.getByText(/A decisão é sua\. Nada muda no treino até você publicar uma versão nova/)).toBeInTheDocument();
    expect(screen.getByText(/O aluno não vê esta sugestão/)).toBeInTheDocument();
    // A prancha é por tempo: sem faixa em número, sem sugestão inventada.
    expect(screen.getByText(/Ainda sem dados para sugerir: A · Prancha\./)).toBeInTheDocument();
  });

  it("a recepção não vê nada, e a tela nem pede os dados", () => {
    papel = "recepcao";
    const { container } = montar();
    expect(container).toBeEmptyDOMElement();
    expect(consultadas).toEqual([]);
  });

  it("a nutricionista atende a saúde, mas não prescreve treino: não vê", () => {
    papel = "nutricionista";
    const { container } = montar();
    expect(container).toBeEmptyDOMElement();
    expect(consultadas).toEqual([]);
  });

  it("o aluno do Método: a academia não vê; o mentor, na ficha do Método, vê", async () => {
    alunoNoTopo({ metodo: true });
    const academia = montar();
    await vi.waitFor(() => expect(consultadas.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(academia.queryByRole("status")).toBeNull());
    expect(academia.container).toBeEmptyDOMElement();
    academia.unmount();

    papel = null;
    montar("metodo");
    expect(await screen.findByText("Pode subir a carga: completou o topo da faixa com folga em 2 treinos.")).toBeInTheDocument();
  });

  it("dor no último treino: segura e avisa no alto, mesmo no topo da faixa", async () => {
    alunoNoTopo({ sensacao: "dor" });
    montar();
    expect(await screen.findByText("Segurar e conversar com o aluno sobre a dor.")).toBeInTheDocument();
    expect(screen.getByText(/O aluno relatou dor em .* Converse com ele antes de mexer na carga\./)).toBeInTheDocument();
    expect(screen.queryByText(/Pode subir/)).toBeNull();
  });

  it("a progressão suspensa vem da tabela própria, e não de alunos: segura e avisa", async () => {
    alunoNoTopo({ suspensa: true });
    montar();
    expect(await screen.findByText("Segurar e conversar com o aluno sobre a dor.")).toBeInTheDocument();
    expect(screen.getByText(/A progressão está suspensa por relato de dor\./)).toBeInTheDocument();
    expect(consultadas).toContain("aluno_progressao_bloqueada");
  });

  it("a consulta falhou: diz que falhou, e não que não há dados", async () => {
    falhar = true;
    montar();
    expect(await screen.findByText("Não foi possível carregar a sugestão de progressão.")).toBeInTheDocument();
    expect(screen.queryByText(/Ainda sem dados/)).toBeNull();
  });
});

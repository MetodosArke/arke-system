import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AvisoRotinas, SaudeRotinas } from "./SaudeRotinas";
import {
  problemaCapacidade,
  problemaReconciliacao,
  rotinasComProblema,
  type Capacidade,
  type Reconciliacao,
  type Rotina,
} from "@/lib/rotinas";

const rpc = vi.fn();
const ultimaReconciliacao = vi.fn();
// Encadeamento de .from(...).select().eq().order().limit().maybeSingle().
function consulta() {
  const c = { select: () => c, eq: () => c, order: () => c, limit: () => c, maybeSingle: () => ultimaReconciliacao() };
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: () => consulta() },
}));

function rotina(parcial: Partial<Rotina>): Rotina {
  return {
    nome: "arke-ativacao-pendente",
    agendamento: "0 * * * *",
    ativa: true,
    situacao: "ok",
    ultima_execucao: "2026-09-21T16:00:00Z",
    ultimo_erro: null,
    falhas_7d: 0,
    execucoes_7d: 168,
    ...parcial,
  };
}

function montar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  rpc.mockReset();
  ultimaReconciliacao.mockReset();
  ultimaReconciliacao.mockResolvedValue({ data: null, error: null });
});

describe("rotinasComProblema", () => {
  it("pega falha e parada; ignora ok, desativada e a que ainda não teve a primeira janela", () => {
    const lista = [
      rotina({ nome: "a", situacao: "ok" }),
      rotina({ nome: "b", situacao: "falhou" }),
      rotina({ nome: "c", situacao: "atrasada" }),
      rotina({ nome: "d", situacao: "nunca_rodou" }),
      rotina({ nome: "e", situacao: "desativada" }),
    ];
    expect(rotinasComProblema(lista).map((r) => r.nome)).toEqual(["b", "c"]);
  });
});

describe("AvisoRotinas", () => {
  it("não aparece quando está tudo ok — aviso que sempre aparece deixa de ser lido", async () => {
    rpc.mockResolvedValue({ data: [rotina({}), rotina({ nome: "snapshot-mrr-diario" })], error: null });
    const { container } = montar(<AvisoRotinas />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("nomeia a rotina quando é uma só", async () => {
    rpc.mockResolvedValue({ data: [rotina({ nome: "arke-escalonamento-sla", situacao: "atrasada" })], error: null });
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/"arke-escalonamento-sla" parou de rodar/)).toBeInTheDocument();
  });

  it("conta quando são várias", async () => {
    rpc.mockResolvedValue({
      data: [rotina({ nome: "a", situacao: "falhou" }), rotina({ nome: "b", situacao: "atrasada" })],
      error: null,
    });
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/2 rotinas agendadas precisam de atenção/)).toBeInTheDocument();
  });
});

describe("SaudeRotinas", () => {
  it("mostra o erro da última execução que falhou", async () => {
    rpc.mockResolvedValue({
      data: [rotina({ situacao: "falhou", ultimo_erro: 'ERROR: relation "x" does not exist', falhas_7d: 3 })],
      error: null,
    });
    montar(<SaudeRotinas />);
    expect(await screen.findByText(/relation "x" does not exist/)).toBeInTheDocument();
    expect(screen.getByText(/3 com falha/)).toBeInTheDocument();
    expect(screen.getByText("falhou")).toBeInTheDocument();
  });
});

const RECONCILIACAO_OK: Reconciliacao = {
  executada_em: "2026-09-21T04:30:00Z",
  cobrancas_verificadas: 40,
  divergencias: 0,
  corrigidas: 0,
  assinaturas_orfas: 0,
  erro: null,
};
const AGORA = new Date("2026-09-21T12:00:00Z").getTime();

describe("problemaReconciliacao", () => {
  it("varredura limpa e recente não é problema", () => {
    expect(problemaReconciliacao(RECONCILIACAO_OK, AGORA)).toBeNull();
  });

  it("assinatura órfã é problema — alguém pode estar sendo cobrado sem ninguém ver", () => {
    expect(problemaReconciliacao({ ...RECONCILIACAO_OK, assinaturas_orfas: 2 }, AGORA)).toMatch(/2 assinaturas ativas/);
  });

  it("erro na varredura é problema", () => {
    expect(problemaReconciliacao({ ...RECONCILIACAO_OK, erro: "Asaas respondeu 401" }, AGORA)).toMatch(/terminou com erro/);
  });

  it("mais de dois dias sem varredura é problema: a rotina parou", () => {
    const velha = { ...RECONCILIACAO_OK, executada_em: "2026-09-18T04:30:00Z" };
    expect(problemaReconciliacao(velha, AGORA)).toMatch(/não roda há mais de dois dias/);
  });

  it("sem nenhuma varredura não alarma sozinho — quem acusa é a saúde da rotina", () => {
    expect(problemaReconciliacao(null, AGORA)).toBeNull();
  });
});

describe("AvisoRotinas com a reconciliação", () => {
  it("aparece por assinatura órfã mesmo com todas as rotinas ok", async () => {
    rpc.mockResolvedValue({ data: [rotina({})], error: null });
    ultimaReconciliacao.mockResolvedValue({
      data: { ...RECONCILIACAO_OK, executada_em: new Date().toISOString(), assinaturas_orfas: 1 },
      error: null,
    });
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/1 assinatura ativa no Asaas sem registro/)).toBeInTheDocument();
  });
});

describe("capacidade do banco", () => {
  const cap = (situacao: Capacidade["situacao"], detalhe = "430 MB de 500 MB (86%)"): Capacidade => ({
    nome: "capacidade:banco", situacao, usado_mb: 430, limite_mb: 500, percentual: 86, detalhe,
  });

  it("abaixo de 70% não é problema; 70% e 85% são, com o detalhe", () => {
    expect(problemaCapacidade(cap("ok"))).toBeNull();
    expect(problemaCapacidade(null)).toBeNull();
    expect(problemaCapacidade(cap("banco_70", "360 MB de 500 MB (72%)"))).toBe(
      "Banco de dados acima de 70% do limite (360 MB de 500 MB (72%))"
    );
    expect(problemaCapacidade(cap("banco_85"))).toContain("acima de 85%");
  });

  it("faixa aparece só pelo banco, com rotinas e reconciliação em dia", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "get_superadmin_capacidade" ? { data: [cap("banco_85")], error: null } : { data: [rotina({})], error: null }
    );
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/Banco de dados acima de 85% do limite/)).toBeInTheDocument();
  });

  it("rotina com problema e banco perto do limite: nomeia a rotina e avisa do banco", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "get_superadmin_capacidade"
        ? { data: [cap("banco_70")], error: null }
        : { data: [rotina({ nome: "arke-escalonamento-sla", situacao: "atrasada" })], error: null }
    );
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/arke-escalonamento-sla/)).toBeInTheDocument();
    expect(await screen.findByText(/o banco está perto do limite/)).toBeInTheDocument();
  });
});

describe("AvisoRotinas — catraca sem sinal", () => {
  const equipamento = {
    catraca_id: "c1",
    organization_id: "o1",
    academia: "Tietê Fitness",
    catraca: "Entrada",
    status_catraca: "ativo",
    situacao: "offline",
    reportado_em: "2026-09-23T10:00:00Z",
  };

  it("nomeia a academia e a catraca quando é a única coisa fora do lugar", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: nome === "get_superadmin_equipamentos" ? [equipamento] : [], error: null })
    );
    montar(<AvisoRotinas />);
    expect(await screen.findByText(/A catraca de Tietê Fitness \(Entrada\) está sem sinal/)).toBeInTheDocument();
  });

  it("Gateway anterior à 1.0 (sem telemetria) não acende a faixa", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data: nome === "get_superadmin_equipamentos" ? [{ ...equipamento, reportado_em: null }] : [],
        error: null,
      })
    );
    const { container } = montar(<AvisoRotinas />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});

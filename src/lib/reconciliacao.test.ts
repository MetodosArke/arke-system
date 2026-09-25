import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emPedacos,
  eventoParaCorrigir,
  listagensDaVarredura,
  listarTodas,
  origemDaReferencia,
  type PagamentoAsaas,
} from "../../supabase/functions/asaas-reconciliar/fluxo";
import { todasAsLinhas } from "../../supabase/functions/_shared/paginar";

const p = (status: string, extra: Partial<PagamentoAsaas> = {}): PagamentoAsaas => ({ id: "pay_1", status, ...extra });

describe("origem pela referência (o mesmo código da conferência diária)", () => {
  it("reconhece as quatro origens do ARKE e ignora o resto", () => {
    expect(origemDaReferencia("metodo:aluno-1")).toBe("metodo");
    expect(origemDaReferencia("plano:aluno-1")).toBe("plano");
    expect(origemDaReferencia("b2b:org-1")).toBe("b2b");
    expect(origemDaReferencia("avulsa:linha-1")).toBe("avulsa");
    expect(origemDaReferencia("nfse:linha-1")).toBeNull();
    expect(origemDaReferencia("pedido-123")).toBeNull();
    expect(origemDaReferencia(null)).toBeNull();
  });
});

describe("o que reenviar ao webhook", () => {
  it("paga no Asaas e em aberto no banco: reenvia a confirmação", () => {
    expect(eventoParaCorrigir(p("RECEIVED"), "pendente", "plano")).toBe("PAYMENT_RECEIVED");
    expect(eventoParaCorrigir(p("CONFIRMED"), "atrasado", "metodo")).toBe("PAYMENT_CONFIRMED");
    expect(eventoParaCorrigir(p("RECEIVED_IN_CASH"), "pendente", "avulsa")).toBe("PAYMENT_RECEIVED");
  });

  it("vencida no Asaas e pendente no banco: reenvia o atraso", () => {
    expect(eventoParaCorrigir(p("OVERDUE"), "pendente", "b2b")).toBe("PAYMENT_OVERDUE");
  });

  it("removida no Asaas é cancelamento, não estorno", () => {
    expect(eventoParaCorrigir(p("PENDING", { deleted: true }), "pendente", "metodo")).toBe("PAYMENT_DELETED");
    expect(eventoParaCorrigir(p("PENDING", { deleted: true }), "cancelado", "metodo")).toBeNull();
  });

  it("emissão perdida conta, menos na avulsa, que nasce no banco", () => {
    expect(eventoParaCorrigir(p("PENDING"), null, "metodo")).toBe("PAYMENT_CREATED");
    expect(eventoParaCorrigir(p("PENDING"), null, "plano")).toBe("PAYMENT_CREATED");
    expect(eventoParaCorrigir(p("PENDING"), null, "avulsa")).toBeNull();
    expect(eventoParaCorrigir(p("PENDING"), "pendente", "metodo")).toBeNull();
  });

  it("status iguais ou transitórios: nada a fazer", () => {
    expect(eventoParaCorrigir(p("RECEIVED"), "confirmado", "metodo")).toBeNull();
    expect(eventoParaCorrigir(p("AWAITING_RISK_ANALYSIS"), "pendente", "metodo")).toBeNull();
  });
});

describe("listagens em lote", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pede as quatro listagens com as janelas de data", () => {
    const caminhos = listagensDaVarredura((n) => `D-${n}`);
    expect(caminhos).toEqual([
      "/payments?status=OVERDUE",
      "/payments?dateCreated%5Bge%5D=D-3",
      "/payments?paymentDate%5Bge%5D=D-5",
      "/payments?status=CONFIRMED",
    ]);
  });

  it("junta as páginas de 100 em 100 até o hasMore acabar", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const offset = Number(new URL(url).searchParams.get("offset"));
        const tamanho = offset < 200 ? 100 : 37;
        const data = Array.from({ length: tamanho }, (_, i) => ({ id: `pay_${offset + i}` }));
        return new Response(JSON.stringify({ data, hasMore: offset < 200 }), { status: 200 });
      }),
    );
    const itens = await listarTodas<{ id: string }>("https://api.teste/v3", "k", "/payments?status=OVERDUE");
    expect(itens).toHaveLength(237);
    expect(new Set(itens.map((i) => i.id)).size).toBe(237);
    expect(urls.map((u) => u.replace("https://api.teste/v3", ""))).toEqual([
      "/payments?status=OVERDUE&limit=100&offset=0",
      "/payments?status=OVERDUE&limit=100&offset=100",
      "/payments?status=OVERDUE&limit=100&offset=200",
    ]);
  });

  it("falha em vez de fingir que terminou", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "x" }], hasMore: true }), { status: 200 })));
    await expect(listarTodas("https://api.teste/v3", "k", "/payments", 3)).rejects.toThrow(/passou de 3 páginas/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(listarTodas("https://api.teste/v3", "k", "/payments")).rejects.toThrow(/401/);
  });

  it("divide ids em pedaços para a consulta ao banco", () => {
    expect(emPedacos(Array.from({ length: 250 }, (_, i) => i)).map((x) => x.length)).toEqual([100, 100, 50]);
  });
});

describe("todasAsLinhas (paginação do banco nas edge functions)", () => {
  it("lê de mil em mil até a página vir incompleta", async () => {
    const pedidos: [number, number][] = [];
    const linhas = await todasAsLinhas<number>(async (de, ate) => {
      pedidos.push([de, ate]);
      const fim = Math.min(ate, 2499);
      return { data: de > 2499 ? [] : Array.from({ length: fim - de + 1 }, (_, i) => de + i), error: null };
    });
    expect(linhas).toHaveLength(2500);
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("propaga o erro do banco", async () => {
    await expect(todasAsLinhas(async () => ({ data: null, error: { message: "falhou" } }))).rejects.toThrow("falhou");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correcaoAplicada,
  DESFECHOS_QUE_CORRIGEM,
  emPedacos,
  eventoParaCorrigir,
  idDoReenvio,
  listagensDaVarredura,
  listarTodas,
  origemDaReferencia,
  valorDiverge,
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

describe("valor no Asaas contra o banco", () => {
  it("acusa diferença acima de um centavo, e só com os dois valores", () => {
    expect(valorDiverge(129.9, "129.90")).toBe(false);
    expect(valorDiverge(129.9, 129.91)).toBe(false);
    expect(valorDiverge(129.9, 119.9)).toBe(true);
    expect(valorDiverge(129.9, "119.90")).toBe(true);
    expect(valorDiverge(undefined, 119.9)).toBe(false);
    expect(valorDiverge(129.9, null)).toBe(false);
    expect(valorDiverge(129.9, "abc")).toBe(false);
  });
});

describe("o reenvio corrigiu? (o desfecho que o webhook gravou)", () => {
  const processado = (resultado: string) => ({ processado: true, resultado, erro: null });

  it("o id do reenvio é o mesmo para a mesma divergência", () => {
    expect(idDoReenvio(p("RECEIVED"))).toBe("reconciliacao:pay_1:RECEIVED");
    expect(idDoReenvio(p("PENDING", { deleted: true }))).toBe("reconciliacao:pay_1:DELETED");
  });

  it("corrigiu: processado, desfecho que mexe na cobrança e o status do Asaas no banco", () => {
    expect(correcaoAplicada(processado("mensalidade_atualizada"), "confirmado", p("RECEIVED"))).toEqual({
      corrigida: true,
      desfecho: "mensalidade_atualizada",
    });
    expect(correcaoAplicada(processado("pagamento_arke_emitido"), "pendente", p("PENDING")).corrigida).toBe(true);
    expect(correcaoAplicada(processado("cobranca_b2b_atualizada"), "cancelado", p("PENDING", { deleted: true })).corrigida).toBe(true);
  });

  it("o 200 do aviso ignorado, sem correspondência ou de outro ambiente não é correção", () => {
    for (const desfecho of ["sem_correspondencia", "evento_ignorado", "sem_payment_id", "ambiente_incompativel:producao", "cartao_recusado"]) {
      expect(correcaoAplicada(processado(desfecho), "pendente", p("RECEIVED"))).toEqual({ corrigida: false, desfecho });
    }
  });

  it("erro interno do webhook, aviso sem processar ou sem registro não é correção", () => {
    expect(correcaoAplicada({ processado: false, resultado: null, erro: "Error: Falha no banco: 23514" }, "pendente", p("RECEIVED"))).toEqual({
      corrigida: false,
      desfecho: "erro_no_webhook",
    });
    expect(correcaoAplicada({ processado: false, resultado: null, erro: null }, "pendente", p("RECEIVED")).desfecho).toBe("nao_processado");
    expect(correcaoAplicada(null, "pendente", p("RECEIVED")).desfecho).toBe("aviso_nao_registrado");
  });

  it("transição recusada em silêncio pelo banco não é correção, mesmo com o desfecho 'atualizada'", () => {
    // O Asaas diz vencida, o banco tem paga: trg_transicao_cobranca mantém paga.
    expect(correcaoAplicada(processado("mensalidade_atualizada"), "confirmado", p("OVERDUE"))).toEqual({
      corrigida: false,
      desfecho: "mensalidade_atualizada:status_confirmado",
    });
    // Aviso repetido (já processado antes) e a divergência continua: não corrigiu agora.
    expect(correcaoAplicada(processado("pagamento_arke_atualizado"), "pendente", p("RECEIVED")).corrigida).toBe(false);
  });

  it("todos os desfechos de correção são desfechos que o webhook grava", () => {
    const webhook = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "asaas-webhook", "index.ts"), "utf8");
    for (const d of DESFECHOS_QUE_CORRIGEM) expect(webhook, d).toContain(`"${d}"`);
  });

  it("a conferência decide pelo desfecho gravado, e não pelo 200 da resposta", () => {
    const funcao = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "asaas-reconciliar", "index.ts"), "utf8");
    expect(funcao).not.toMatch(/return resp\.ok;/);
    expect(funcao).toMatch(/from\("asaas_webhook_events"\)\.select\("processado, resultado, erro"\)\.eq\("asaas_event_id", idAviso\)/);
    expect(funcao).toMatch(/return correcaoAplicada\(/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buscarTaxaExistente,
  emitirOuAdotarTaxa,
  linhasDasParcelas,
  resumoDaTaxa,
  type ParcelaAsaas,
} from "../../supabase/functions/asaas-taxa-implantacao/fluxo";

const API = "https://api.teste/v3";
const ORG = "11111111-2222-3333-4444-555555555555";

const parcela = (n: number, extra: Partial<ParcelaAsaas> = {}): ParcelaAsaas => ({
  id: `pay_${n}`,
  customer: "cus_1",
  value: n === 3 ? 496.68 : 496.66,
  dueDate: `2026-${String(9 + n).padStart(2, "0")}-24`,
  description: `Parcela ${n} de 3. Taxa de implantação ARKE`,
  installment: "ins_1",
  installmentNumber: n,
  ...extra,
});

/** Um Asaas de mentira: guarda o que foi pedido e responde pela rota. */
function asaasFalso(rotas: { porReferencia: ParcelaAsaas[]; parcelas?: ParcelaAsaas[]; criada?: ParcelaAsaas; statusReferencia?: number }) {
  const pedidos: { metodo: string; caminho: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const caminho = url.replace(API, "");
      const metodo = init?.method ?? "GET";
      pedidos.push({ metodo, caminho });
      if (metodo === "GET" && caminho.startsWith("/payments?externalReference=")) {
        return new Response(JSON.stringify({ data: rotas.porReferencia }), { status: rotas.statusReferencia ?? 200 });
      }
      if (metodo === "GET" && caminho.startsWith("/payments?installment=")) {
        return new Response(JSON.stringify({ data: rotas.parcelas ?? [] }), { status: 200 });
      }
      if (metodo === "POST" && caminho === "/payments") {
        return new Response(JSON.stringify(rotas.criada ?? {}), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return pedidos;
}

afterEach(() => vi.unstubAllGlobals());

describe("taxa de implantação: buscar sem criar (o mesmo código da edge function)", () => {
  it("acha a taxa pela referência e devolve todas as parcelas, em ordem", async () => {
    const pedidos = asaasFalso({ porReferencia: [parcela(2)], parcelas: [parcela(3), parcela(1), parcela(2)] });
    const t = await buscarTaxaExistente(API, "k", ORG);
    expect(t?.installmentId).toBe("ins_1");
    expect(t?.parcelas.map((x) => x.id)).toEqual(["pay_1", "pay_2", "pay_3"]);
    expect(pedidos.every((x) => x.metodo === "GET")).toBe(true);
  });

  it("cobrança da mesma referência que não é a taxa (a mensalidade B2B) não conta", async () => {
    asaasFalso({ porReferencia: [parcela(1, { description: "Mensalidade ARKE", installment: null })] });
    expect(await buscarTaxaExistente(API, "k", ORG)).toBeNull();
  });

  it("parcela apagada no Asaas não conta", async () => {
    asaasFalso({ porReferencia: [parcela(1, { deleted: true })] });
    expect(await buscarTaxaExistente(API, "k", ORG)).toBeNull();
  });

  it("Asaas fora do ar é falha, e não 'não existe' — senão a tentativa seguinte criaria outra", async () => {
    asaasFalso({ porReferencia: [], statusReferencia: 503 });
    await expect(buscarTaxaExistente(API, "k", ORG)).rejects.toThrow(/503/);
  });
});

describe("taxa de implantação: emitir ou adotar", () => {
  const pedido = { valor: 1490, parcelas: 3, vencimento: "2026-10-24" };

  it("a taxa que já existe no Asaas é adotada, sem POST", async () => {
    const pedidos = asaasFalso({ porReferencia: [parcela(1)], parcelas: [parcela(1), parcela(2), parcela(3)] });
    const r = await emitirOuAdotarTaxa(API, "k", { orgId: ORG, cliente: "cus_1", pedido });
    expect(r.ok && r.adotada).toBe(true);
    expect(pedidos.some((x) => x.metodo === "POST")).toBe(false);
  });

  it("sem taxa no Asaas, cria uma vez, com a referência da academia", async () => {
    const pedidos = asaasFalso({ porReferencia: [], criada: parcela(1), parcelas: [parcela(1), parcela(2), parcela(3)] });
    const r = await emitirOuAdotarTaxa(API, "k", { orgId: ORG, cliente: "cus_1", pedido });
    expect(r.ok && !r.adotada && r.parcelas.length).toBe(3);
    expect(pedidos.filter((x) => x.metodo === "POST")).toHaveLength(1);
  });

  it("Asaas fora do ar na busca não cria (falha que pode passar)", async () => {
    const pedidos = asaasFalso({ porReferencia: [], statusReferencia: 502 });
    const r = await emitirOuAdotarTaxa(API, "k", { orgId: ORG, cliente: "cus_1", pedido });
    expect(r).toMatchObject({ ok: false, definitivo: false });
    expect(pedidos.some((x) => x.metodo === "POST")).toBe(false);
  });
});

describe("taxa de implantação: o que vai para o banco", () => {
  it("cada parcela vira uma cobrança B2B pendente, com o id do Asaas", () => {
    const linhas = linhasDasParcelas([parcela(1), parcela(2)], { orgId: ORG, cliente: "cus_1", criadoPor: "u1" });
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatchObject({ organization_id: ORG, asaas_payment_id: "pay_1", status: "pendente", vencimento: "2026-10-24", criado_por: "u1" });
  });

  it("a linha da taxa guarda o que o Asaas emitiu, não o pedido de outra tentativa", () => {
    const r = resumoDaTaxa({ installmentId: "ins_1", parcelas: [parcela(1), parcela(2), parcela(3)] }, { valor: 990, parcelas: 1, vencimento: "2026-12-01" });
    expect(r).toEqual({ valor_total: 1490, parcelas: 3, primeiro_vencimento: "2026-10-24", asaas_installment_id: "ins_1" });
  });
});

describe("taxa de implantação: a edge function", () => {
  const funcao = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "asaas-taxa-implantacao", "index.ts"), "utf8");
  const reserva = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261366010000_taxa_implantacao_reserva.sql"), "utf8");

  it("reserva no banco antes de falar com o Asaas", () => {
    const reservar = funcao.indexOf('admin.rpc("reservar_taxa_implantacao"');
    expect(reservar).toBeGreaterThan(0);
    expect(reservar).toBeLessThan(funcao.indexOf("await garantirClienteB2b("));
    expect(reservar).toBeLessThan(funcao.indexOf("await emitirOuAdotarTaxa("));
  });

  it("a taxa já emitida completa o registro só procurando no Asaas, nunca emitindo outra", () => {
    const completar = funcao.slice(funcao.indexOf("const completarRegistro"), funcao.indexOf("if (completar || !pedido)"));
    expect(completar).toContain("buscarTaxaExistente(");
    expect(completar).not.toContain("emitirOuAdotarTaxa(");
  });

  it("a nova tentativa não regrava as parcelas que já estão no banco (a paga continua paga)", () => {
    expect(funcao).toMatch(/onConflict: "asaas_payment_id", ignoreDuplicates: true/);
  });

  it("a reserva é única por academia junto com a emitida, e só a vencida é assumida", () => {
    expect(reserva).toMatch(/on public\.taxas_implantacao \(organization_id\) where status in \('emitindo', 'emitida'\)/);
    expect(reserva).toMatch(/on conflict \(organization_id\) where status in \('emitindo', 'emitida'\)/);
    expect(reserva).toMatch(/where t\.status = 'emitindo' and \(t\.reservada_ate is null or t\.reservada_ate <= now\(\)\)/);
  });
});

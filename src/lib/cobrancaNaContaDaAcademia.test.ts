import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contaDaLinha,
  contaParaNovaCobranca,
  divisaoDaCobranca,
} from "../../supabase/functions/_shared/contaCobranca";
import { clientePrecisaReativar, emitirCobrancaAvulsa, obterOuCriarCustomer } from "../../supabase/functions/asaas-cobranca-avulsa/fluxo";
import { alterarValorAssinatura } from "../../supabase/functions/asaas-assinatura-ciclo/fluxo";
import { criarAssinaturaDoPlano } from "../../supabase/functions/academia-criar-matricula/fluxo";
import { garantirCliente } from "../../supabase/functions/nfse-emitir/fluxo";
import {
  cobrancaDaConta,
  contaDaCobrancaNoBanco,
  origemDaReferencia,
  origensDaConta,
} from "../../supabase/functions/asaas-reconciliar/fluxo";

/**
 * A cobrança na conta da academia (06/10/2026): o Método fica na conta da
 * ArkeFit; a mensalidade e a avulsa, com o modo ligado, saem da conta da
 * academia sem split e sem taxa; e a cobrança que já existe mora onde nasceu.
 * Os testes exercitam os `fluxo.ts` reais, com o `fetch` trocado.
 */

type Chamada = { url: string; metodo: string; corpo: Record<string, unknown> | null };

function fetchFalso(respostas: (c: Chamada) => { status?: number; corpo: unknown }) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const c: Chamada = { url, metodo: init.method ?? "GET", corpo: init.body ? JSON.parse(String(init.body)) : null };
    chamadas.push(c);
    const r = respostas(c);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

const ALUNO = { alunoId: "11111111-1111-4111-8111-111111111111", nome: "Aluna", cpf: "52998224725", telefone: "11999990000" };

describe("onde a cobrança nova nasce", () => {
  it("o Método é sempre da conta da ArkeFit", () => {
    expect(contaParaNovaCobranca("metodo", true)).toBe("arkefit");
    expect(contaParaNovaCobranca("metodo", false)).toBe("arkefit");
  });
  it("a mensalidade e a avulsa seguem o modo, e o padrão é a conta da ArkeFit", () => {
    expect(contaParaNovaCobranca("plano", true)).toBe("academia");
    expect(contaParaNovaCobranca("avulsa", true)).toBe("academia");
    expect(contaParaNovaCobranca("plano", false)).toBe("arkefit");
    expect(contaParaNovaCobranca("avulsa", null)).toBe("arkefit");
    expect(contaParaNovaCobranca("avulsa", undefined)).toBe("arkefit");
  });
  it("a linha gravada decide a conta; o que não é 'academia' é a da ArkeFit, como sempre foi", () => {
    expect(contaDaLinha("academia")).toBe("academia");
    expect(contaDaLinha("arkefit")).toBe("arkefit");
    expect(contaDaLinha(null)).toBe("arkefit");
    expect(contaDaLinha("qualquer")).toBe("arkefit");
  });
});

describe("a divisão", () => {
  it("na conta da ArkeFit, a taxa fica com ela e o resto vai à carteira da academia em valor fixo", () => {
    expect(divisaoDaCobranca("arkefit", 100, 3.48, "w-1")).toEqual({ repasse: 3.48, liquido: 96.52, split: [{ walletId: "w-1", fixedValue: 96.52 }] });
  });
  it("na conta da academia não há taxa da ArkeFit nem split", () => {
    expect(divisaoDaCobranca("academia", 100, 3.48, "w-1")).toEqual({ repasse: 0, liquido: 100, split: null });
  });
  it("sem a taxa ou sem a carteira, a conta da ArkeFit recusa em vez de cobrar sem divisão", () => {
    expect(divisaoDaCobranca("arkefit", 100, null, "w-1")).toHaveProperty("erro");
    expect(divisaoDaCobranca("arkefit", 100, 3, null)).toHaveProperty("erro");
  });
});

describe("o cliente na conta da academia", () => {
  it("cliente com os avisos desligados (o da nota fiscal) ou anonimizado precisa voltar a receber a fatura", () => {
    expect(clientePrecisaReativar({ notificationDisabled: true })).toBe(true);
    expect(clientePrecisaReativar({ name: "Pessoa anonimizada", notificationDisabled: false })).toBe(true);
    expect(clientePrecisaReativar({ name: "Aluna", notificationDisabled: false })).toBe(false);
  });

  it("na conta da academia, o cliente achado com os avisos desligados é reativado antes de cobrar", async () => {
    const chamadas = fetchFalso((c) =>
      c.metodo === "GET" ? { corpo: { data: [{ id: "cus_1", name: "Aluna", notificationDisabled: true }] } } : { corpo: { id: "cus_1" } },
    );
    expect(await obterOuCriarCustomer("https://api", "k", ALUNO, { reativar: true })).toEqual({ id: "cus_1" });
    const atualizacao = chamadas.find((c) => c.metodo === "POST");
    expect(atualizacao?.url).toBe("https://api/customers/cus_1");
    expect(atualizacao?.corpo).toMatchObject({ notificationDisabled: false, name: "Aluna" });
  });

  it("na conta da ArkeFit (sem reativar), o cliente achado não é tocado — como sempre foi", async () => {
    const chamadas = fetchFalso(() => ({ corpo: { data: [{ id: "cus_1", notificationDisabled: true }] } }));
    expect(await obterOuCriarCustomer("https://api", "k", ALUNO)).toEqual({ id: "cus_1" });
    expect(chamadas.every((c) => c.metodo === "GET")).toBe(true);
  });

  it("a nota fiscal, com a cobrança na conta da academia, deixa os avisos ligados", async () => {
    const tomador = { ...ALUNO, email: null, endereco: { cep: "01310100", logradouro: "Av. Paulista", numero: "1000", complemento: null, bairro: "Bela Vista" } };
    let chamadas = fetchFalso((c) => (c.metodo === "GET" ? { corpo: { data: [] } } : { corpo: { id: "cus_9" } }));
    await garantirCliente("https://api", "k", tomador, { cobrancaNaConta: true });
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toMatchObject({ notificationDisabled: false });
    vi.unstubAllGlobals();
    chamadas = fetchFalso((c) => (c.metodo === "GET" ? { corpo: { data: [] } } : { corpo: { id: "cus_9" } }));
    await garantirCliente("https://api", "k", tomador);
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo).toMatchObject({ notificationDisabled: true });
  });
});

describe("a cobrança sem split", () => {
  const dados = {
    referencia: "avulsa:22222222-2222-4222-8222-222222222222",
    aluno: ALUNO,
    valor: 80,
    vencimento: "2026-10-06",
    descricao: "Academia — Avaliação",
  };

  it("a avulsa na conta da academia vai sem split, e com split na da ArkeFit", async () => {
    let chamadas = fetchFalso((c) =>
      c.url.includes("/payments?") ? { corpo: { data: [] } } : c.url.includes("/customers?") ? { corpo: { data: [{ id: "cus_1" }] } } : { corpo: { id: "pay_1", status: "PENDING", value: 80, dueDate: "2026-10-06" } },
    );
    await emitirCobrancaAvulsa("https://api", "k", { ...dados, walletAcademia: null, valorLiquidoAcademia: 80 });
    const semSplit = chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/payments"));
    expect(semSplit?.corpo).not.toHaveProperty("split");

    vi.unstubAllGlobals();
    chamadas = fetchFalso((c) =>
      c.url.includes("/payments?") ? { corpo: { data: [] } } : c.url.includes("/customers?") ? { corpo: { data: [{ id: "cus_1" }] } } : { corpo: { id: "pay_1", status: "PENDING", value: 80, dueDate: "2026-10-06" } },
    );
    await emitirCobrancaAvulsa("https://api", "k", { ...dados, walletAcademia: "w-1", valorLiquidoAcademia: 76.62 });
    const comSplit = chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/payments"));
    expect(comSplit?.corpo).toMatchObject({ split: [{ walletId: "w-1", fixedValue: 76.62 }] });
  });

  it("sem split, a academia fica com o valor inteiro: a avulsa que tirasse algo é recusada antes do Asaas", async () => {
    const chamadas = fetchFalso(() => ({ corpo: {} }));
    const r = await emitirCobrancaAvulsa("https://api", "k", { ...dados, walletAcademia: null, valorLiquidoAcademia: 76.62 });
    expect(r).toMatchObject({ ok: false, definitivo: true });
    expect(chamadas).toEqual([]);
  });

  it("a mensalidade na conta da academia nasce sem split", async () => {
    const chamadas = fetchFalso(() => ({ corpo: { id: "sub_1" } }));
    const base = { customerId: "cus_1", valor: 120, periodicidade: "mensal", primeiroVencimento: "2026-10-06", descricao: "A — Plano", referencia: `plano:${ALUNO.alunoId}` };
    await criarAssinaturaDoPlano("https://api", "k", { ...base, split: null });
    expect(chamadas[0].corpo).not.toHaveProperty("split");
    expect(chamadas[0].corpo).toMatchObject({ cycle: "MONTHLY", externalReference: `plano:${ALUNO.alunoId}` });
    await criarAssinaturaDoPlano("https://api", "k", { ...base, split: [{ walletId: "w-1", fixedValue: 116 }] });
    expect(chamadas[1].corpo).toMatchObject({ split: [{ walletId: "w-1", fixedValue: 116 }] });
  });

  it("mudar o valor na conta da academia não manda split, e recusa repasse", async () => {
    const chamadas = fetchFalso((c) => (c.metodo === "GET" ? { corpo: { data: [] } } : { corpo: { id: "sub_1" } }));
    const r = await alterarValorAssinatura("https://api", "k", "sub_1", { valorCobrado: 150, valorRepasseArke: 0, walletAcademia: null, hoje: "2026-10-06" });
    expect(r).toMatchObject({ ok: true, valorAcademia: 150 });
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put?.corpo).not.toHaveProperty("split");
    expect(put?.corpo).toMatchObject({ value: 150 });

    const recusa = await alterarValorAssinatura("https://api", "k", "sub_1", { valorCobrado: 150, valorRepasseArke: 4, walletAcademia: null, hoje: "2026-10-06" });
    expect(recusa).toMatchObject({ ok: false });
  });
});

describe("a conferência por conta", () => {
  it("a conta da ArkeFit tem as quatro origens; a da academia, só a mensalidade e a avulsa", () => {
    expect(origensDaConta({ nome: "arkefit" })).toEqual(["metodo", "plano", "b2b", "avulsa"]);
    expect(origensDaConta({ nome: "academia", organizationId: "o" })).toEqual(["plano", "avulsa"]);
  });
  it("o Método e o B2B moram na conta da ArkeFit, qualquer que seja a coluna", () => {
    expect(contaDaCobrancaNoBanco("metodo", "academia")).toBe("arkefit");
    expect(contaDaCobrancaNoBanco("b2b", "academia")).toBe("arkefit");
    expect(contaDaCobrancaNoBanco("plano", "academia")).toBe("academia");
    expect(contaDaCobrancaNoBanco("avulsa", null)).toBe("arkefit");
  });
  it("a cobrança da conta da academia é conferida só na conta daquela academia", () => {
    const daA = { conta_asaas: "academia", organization_id: "A" };
    expect(cobrancaDaConta({ nome: "academia", organizationId: "A" }, "plano", daA)).toBe(true);
    expect(cobrancaDaConta({ nome: "academia", organizationId: "B" }, "plano", daA)).toBe(false);
    expect(cobrancaDaConta({ nome: "arkefit" }, "plano", daA)).toBe(false);
    expect(cobrancaDaConta({ nome: "arkefit" }, "plano", { conta_asaas: "arkefit", organization_id: "A" })).toBe(true);
  });
  it("na conta da academia, referência do Método ou do B2B não é do ARKE ali", () => {
    expect(origemDaReferencia("metodo:x", ["plano", "avulsa"])).toBeNull();
    expect(origemDaReferencia("b2b:x", ["plano", "avulsa"])).toBeNull();
    expect(origemDaReferencia("plano:x", ["plano", "avulsa"])).toBe("plano");
    expect(origemDaReferencia("metodo:x")).toBe("metodo");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autenticacaoEnviada,
  chaveCombinaComAmbiente,
  descricaoErro,
  emitirNota,
  enderecoCompleto as enderecoCompletoFluxo,
  situacaoDaNota,
  type PedidoNota,
} from "../../supabase/functions/nfse-emitir/fluxo";
import { ENDERECO_VAZIO, autenticacaoOk, enderecoCompleto, type Autenticacao, type SituacaoFiscal } from "./notaFiscal";

describe("chaveCombinaComAmbiente", () => {
  it("chave de sandbox só em homologação, chave de produção só em produção", () => {
    expect(chaveCombinaComAmbiente("$aact_hmlg_abc", "sandbox")).toBe(true);
    expect(chaveCombinaComAmbiente("$aact_hmlg_abc", "producao")).toBe(false);
    expect(chaveCombinaComAmbiente("$aact_prod_abc", "producao")).toBe(true);
    expect(chaveCombinaComAmbiente("$aact_prod_abc", "sandbox")).toBe(false);
    // Qualquer coisa que não é chave do Asaas não serve em lugar nenhum.
    expect(chaveCombinaComAmbiente("chave-qualquer", "producao")).toBe(false);
  });
});

describe("autenticação na prefeitura", () => {
  const combinacoes = [false, true].flatMap((certificateSent) =>
    [false, true].flatMap((passwordSent) => [false, true].map((accessTokenSent) => ({ certificateSent, passwordSent, accessTokenSent }))),
  );
  const exigencias: (Autenticacao | null)[] = ["CERTIFICATE", "USER_AND_PASSWORD", "TOKEN", null];

  it("conta só o meio que a prefeitura exige", () => {
    const envio = { certificateSent: false, passwordSent: true, accessTokenSent: false };
    expect(autenticacaoEnviada("CERTIFICATE", envio)).toBe(false);
    expect(autenticacaoEnviada("USER_AND_PASSWORD", envio)).toBe(true);
    expect(autenticacaoEnviada(null, envio)).toBe(true);
    expect(autenticacaoEnviada("TOKEN", null)).toBe(false);
  });

  it("a tela e a edge function decidem igual em todas as combinações", () => {
    for (const exigida of exigencias) {
      for (const envio of combinacoes) {
        const s = {
          conectada: true,
          cidade: null,
          uf: null,
          opcoes: exigida ? ({ authenticationType: exigida } as never) : null,
          cadastro: { ...envio } as never,
          config: null,
          pronta: false,
        } as Extract<SituacaoFiscal, { conectada: true }>;
        expect(autenticacaoOk(s), `${exigida} ${JSON.stringify(envio)}`).toBe(autenticacaoEnviada(exigida, envio));
      }
    }
  });
});

describe("endereço do aluno", () => {
  const completo = { cep: "01310-100", logradouro: "Avenida Paulista", numero: "1000", complemento: "", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP" };

  it("na tela, pede tudo menos o complemento", () => {
    expect(enderecoCompleto(completo)).toBe(true);
    expect(enderecoCompleto(ENDERECO_VAZIO)).toBe(false);
    for (const campo of ["cep", "logradouro", "numero", "bairro", "cidade", "uf"] as const) {
      expect(enderecoCompleto({ ...completo, [campo]: " " }), campo).toBe(false);
    }
    expect(enderecoCompleto({ ...completo, cep: "0131010" })).toBe(false);
    expect(enderecoCompleto({ ...completo, uf: "São Paulo" })).toBe(false);
  });

  it("no envio à prefeitura, o CEP vai só com os dígitos", () => {
    expect(enderecoCompletoFluxo({ cep: "01310100", logradouro: "Av. Paulista", numero: "1000", complemento: null, bairro: "Bela Vista" })).toBe(true);
    expect(enderecoCompletoFluxo({ cep: "01310-100", logradouro: "Av. Paulista", numero: "1000", complemento: null, bairro: "Bela Vista" })).toBe(false);
    expect(enderecoCompletoFluxo(null)).toBe(false);
  });
});

describe("situação da nota", () => {
  it("traduz o Asaas para a linha do ARKE", () => {
    expect(situacaoDaNota("AUTHORIZED")).toBe("emitida");
    expect(situacaoDaNota("ERROR")).toBe("erro");
    expect(situacaoDaNota("CANCELED")).toBe("cancelada");
    expect(situacaoDaNota("PROCESSING_CANCELLATION")).toBe("cancelando");
    expect(situacaoDaNota("CANCELLATION_DENIED")).toBe("cancelamento_negado");
    // Ainda na prefeitura: nada muda até ela responder.
    expect(situacaoDaNota("SCHEDULED")).toBeNull();
    expect(situacaoDaNota("SYNCHRONIZED")).toBeNull();
  });

  it("junta as mensagens de erro do Asaas", () => {
    expect(descricaoErro({ errors: [{ description: "CEP do cliente é inválido." }, { description: "Endereço incompleto." }] })).toBe(
      "CEP do cliente é inválido. Endereço incompleto.",
    );
    expect(descricaoErro({})).toBeNull();
  });
});

describe("emitirNota (o mesmo código da edge function)", () => {
  const API = "https://asaas.teste/v3";
  const pedido: PedidoNota = {
    referencia: "nfse:linha-1",
    cliente: "cus_1",
    descricao: "Mensalidade — Plano Mensal",
    observacoes: "Emitida pelo ARKE.",
    valor: 125.53,
    data: "2026-09-24",
    servico: { id: "srv_1", codigo: null, nome: "Ginástica" },
    iss: 2,
  };
  type Chamada = { metodo: string; caminho: string; corpo: unknown };
  const simular = (respostas: ((c: Chamada) => { status: number; corpo: unknown } | "rede")[]) => {
    const chamadas: Chamada[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const c = { metodo: init.method ?? "GET", caminho: url.slice(API.length), corpo: init.body ? JSON.parse(String(init.body)) : undefined };
        chamadas.push(c);
        const r = respostas[chamadas.length - 1](c);
        if (r === "rede") throw new TypeError("fetch failed");
        return new Response(JSON.stringify(r.corpo), { status: r.status });
      }),
    );
    return chamadas;
  };
  // O Deno tem AbortSignal.timeout e o jsdom não; sem isso, toda chamada viraria "falha de rede".
  const timeoutOriginal = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  beforeEach(() => {
    Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (timeoutOriginal) Object.defineProperty(AbortSignal, "timeout", timeoutOriginal);
    else delete (AbortSignal as unknown as { timeout?: unknown }).timeout;
  });

  it("cria com o valor da academia e o ISS dela, e pede a emissão", async () => {
    const chamadas = simular([
      () => ({ status: 200, corpo: { data: [] } }),
      () => ({ status: 200, corpo: { id: "inv_1", status: "SCHEDULED" } }),
      () => ({ status: 200, corpo: { id: "inv_1", status: "SYNCHRONIZED" } }),
    ]);
    const r = await emitirNota(API, "$aact_hmlg_x", pedido);
    expect(r).toEqual({ ok: true, nota: { id: "inv_1", status: "SYNCHRONIZED" } });
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      "GET /invoices?externalReference=nfse%3Alinha-1",
      "POST /invoices",
      "POST /invoices/inv_1/authorize",
    ]);
    expect(chamadas[1].corpo).toMatchObject({
      customer: "cus_1",
      value: 125.53,
      externalReference: "nfse:linha-1",
      municipalServiceId: "srv_1",
      taxes: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
    });
  });

  it("adota a nota que já existe em vez de criar outra, e ignora a cancelada", async () => {
    const chamadas = simular([
      () => ({ status: 200, corpo: { data: [{ id: "inv_velha", status: "CANCELED" }, { id: "inv_1", status: "AUTHORIZED" }] } }),
    ]);
    const r = await emitirNota(API, "$aact_hmlg_x", pedido);
    expect(r.ok && r.nota.id).toBe("inv_1");
    expect(chamadas).toHaveLength(1);
  });

  it("prefeitura recusando a emissão devolve a nota agendada, como falha definitiva", async () => {
    simular([
      () => ({ status: 200, corpo: { data: [] } }),
      () => ({ status: 200, corpo: { id: "inv_1", status: "SCHEDULED" } }),
      () => ({ status: 400, corpo: { errors: [{ description: "CEP do cliente é inválido." }] } }),
    ]);
    const r = await emitirNota(API, "$aact_hmlg_x", pedido);
    expect(r).toEqual({ ok: false, erro: "CEP do cliente é inválido.", definitivo: true, nota: { id: "inv_1", status: "SCHEDULED" } });
  });

  it("falha de rede não é definitiva: a próxima rodada tenta de novo, e adota se tiver criado", async () => {
    simular([() => ({ status: 200, corpo: { data: [] } }), () => "rede"]);
    const r = await emitirNota(API, "$aact_hmlg_x", pedido);
    expect(r).toEqual({ ok: false, erro: "Não foi possível falar com o Asaas agora.", definitivo: false });
  });
});

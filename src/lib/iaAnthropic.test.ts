import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consultarAssistente,
  consultarVigia,
  MODELO_ASSISTENTE,
  MODELO_ASSISTENTE_API,
  MODELO_VIGIA,
  MODELO_VIGIA_API,
} from "../../supabase/functions/_shared/ia";
import { agenteNaAnthropic } from "../../supabase/functions/_shared/iaAnthropic";
import { interpretarResposta, NOME_FERRAMENTA_ANALISE, type Quadro } from "../../supabase/functions/_shared/vigiaAnalise";

/**
 * O caminho pela API da Anthropic (09/10/2026), com a AWS de reserva, contra
 * o código real de `_shared/ia.ts`, com o `fetch` simulado: nada sai da
 * máquina. As chaves abaixo são de mentira.
 */

const AWS = { BEDROCK_ACCESS_KEY_ID: "AKIA-teste", BEDROCK_SECRET_ACCESS_KEY: "segredo-teste" };
const LIGADO = { ...AWS, ANTHROPIC_API_KEY: "chave-de-teste", IA_ANTHROPIC_AGENTES: "vigia, assistente" };
const env = (vars: Record<string, string>) => (n: string) => vars[n];

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const daApi = (texto: string) => json({ content: [{ type: "text", text: texto }], usage: { input_tokens: 11, output_tokens: 6 }, stop_reason: "end_turn" });
const daAws = (texto: string) => json({ output: { message: { content: [{ text: texto }] } }, usage: { inputTokens: 10, outputTokens: 5 } });
const creditoEsgotado = () =>
  json({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, 400);

type Chamada = { url: string; init: RequestInit; corpo: Record<string, unknown> };
function simular(...respostas: (Response | Error | DOMException)[]): Chamada[] {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url: String(url), init, corpo: JSON.parse(String(init.body)) });
      const r = respostas.shift();
      if (!r) throw new Error("chamada a mais");
      if (!(r instanceof Response)) throw r;
      return r;
    }),
  );
  return chamadas;
}

const API = "https://api.anthropic.com/v1/messages";
const ehAws = (url: string) => url.startsWith("https://bedrock-runtime.sa-east-1.amazonaws.com/model/");
const PERGUNTA = "Como libero a catraca para quem pagou hoje?";
const dadosAssistente = () => ({
  sistema: "Roteiro do assistente.",
  pergunta: PERGUNTA,
  trechos: [{ artigo: "Catraca", secao: "Liberação", texto: "A catraca libera quem está em dia." }],
  situacao: "",
  nomes: [],
});

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o interruptor por agente", () => {
  it("liga só com a chave e o agente na lista", () => {
    expect(agenteNaAnthropic(env(LIGADO), "vigia")).toBe(true);
    expect(agenteNaAnthropic(env(LIGADO), "assistente")).toBe(true);
    expect(agenteNaAnthropic(env({ ...LIGADO, IA_ANTHROPIC_AGENTES: "vigia" }), "assistente")).toBe(false);
    expect(agenteNaAnthropic(env({ ...LIGADO, IA_ANTHROPIC_AGENTES: "" }), "vigia")).toBe(false);
    expect(agenteNaAnthropic(env({ ...LIGADO, ANTHROPIC_API_KEY: " " }), "vigia")).toBe(false);
    expect(agenteNaAnthropic(env({ ANTHROPIC_API_KEY: "x" }), "vigia")).toBe(false);
    // Nome parecido não liga: a lista é exata.
    expect(agenteNaAnthropic(env({ ...LIGADO, IA_ANTHROPIC_AGENTES: "vigias,assistente-academia" }), "vigia")).toBe(false);
  });
});

describe("assistente da academia", () => {
  it("sucesso na Anthropic: o mesmo modelo, o mesmo roteiro e a mesma entrada, e a AWS nem é chamada", async () => {
    const chamadas = simular(daApi("Resposta da API."));
    const r = await consultarAssistente(env(LIGADO), dadosAssistente());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("Resposta da API.");
    expect(r.uso).toMatchObject({ modelo: MODELO_ASSISTENTE_API, tokensEntrada: 11, tokensSaida: 6 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(API);
    const h = chamadas[0].init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("chave-de-teste");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h).not.toHaveProperty("anthropic-workspace-id");
    expect(chamadas[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(chamadas[0].corpo).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      temperature: 0.2,
      system: "Roteiro do assistente.",
      messages: [{ role: "user", content: r.entrada }],
    });
  });

  it("o workspace vai no cabeçalho só quando está definido", async () => {
    const chamadas = simular(daApi("ok"));
    await consultarAssistente(env({ ...LIGADO, ANTHROPIC_WORKSPACE_ID: "wrkspc_teste" }), dadosAssistente());
    expect((chamadas[0].init.headers as Record<string, string>)["anthropic-workspace-id"]).toBe("wrkspc_teste");
  });

  it("crédito esgotado: a reserva na AWS responde, com a mesma entrada, e o log não leva o corpo", async () => {
    const chamadas = simular(creditoEsgotado(), daAws("Resposta da AWS."));
    const r = await consultarAssistente(env(LIGADO), dadosAssistente());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.texto).toBe("Resposta da AWS.");
    expect(r.uso.modelo).toBe(MODELO_ASSISTENTE);
    expect(chamadas.map((c) => (c.url === API ? "api" : ehAws(c.url) ? "aws" : c.url))).toEqual(["api", "aws"]);
    expect(chamadas[1].url).toContain(encodeURIComponent(MODELO_ASSISTENTE));
    expect(chamadas[1].corpo).toMatchObject({ messages: [{ role: "user", content: [{ text: r.entrada }] }] });
    expect(chamadas[1].init.signal).toBeInstanceOf(AbortSignal);
    const logado = JSON.stringify(log.mock.calls);
    expect(logado).toContain("400");
    expect(logado).not.toMatch(/credit|catraca|chave-de-teste/i);
  });

  it.each([401, 402, 403, 429, 500, 529])("HTTP %i na Anthropic: reserva na AWS", async (status) => {
    const chamadas = simular(json({ type: "error", error: { type: "x", message: "y" } }, status), daAws("AWS."));
    const r = await consultarAssistente(env(LIGADO), dadosAssistente());
    expect(r.ok && r.texto).toBe("AWS.");
    expect(chamadas).toHaveLength(2);
  });

  it("rede fora ou prazo estourado na Anthropic: reserva na AWS", async () => {
    for (const erro of [new TypeError("fetch failed"), new DOMException("prazo", "TimeoutError")]) {
      const chamadas = simular(erro, daAws("AWS."));
      const r = await consultarAssistente(env(LIGADO), dadosAssistente());
      expect(r.ok && r.texto).toBe("AWS.");
      expect(chamadas.map((c) => c.url === API)).toEqual([true, false]);
    }
    expect(JSON.stringify(log.mock.calls)).toContain("TimeoutError");
  });

  it("resposta vazia ou ilegível da Anthropic: reserva na AWS", async () => {
    simular(daApi("   "), daAws("AWS."));
    expect(await consultarAssistente(env(LIGADO), dadosAssistente())).toMatchObject({ ok: true, texto: "AWS." });
    simular(new Response("<html>", { status: 200 }), daAws("AWS."));
    expect(await consultarAssistente(env(LIGADO), dadosAssistente())).toMatchObject({ ok: true, texto: "AWS." });
  });

  it("sem a chave da Anthropic: só a AWS, como antes", async () => {
    const chamadas = simular(daAws("AWS."));
    const r = await consultarAssistente(env({ ...AWS, IA_ANTHROPIC_AGENTES: "vigia,assistente" }), dadosAssistente());
    expect(r).toMatchObject({ ok: true, texto: "AWS.", uso: { modelo: MODELO_ASSISTENTE } });
    expect(chamadas).toHaveLength(1);
    expect(ehAws(chamadas[0].url)).toBe(true);
  });

  it("assistente fora da lista: só a AWS, como antes", async () => {
    const chamadas = simular(daAws("AWS."));
    const r = await consultarAssistente(env({ ...LIGADO, IA_ANTHROPIC_AGENTES: "vigia" }), dadosAssistente());
    expect(r).toMatchObject({ ok: true, texto: "AWS." });
    expect(chamadas).toHaveLength(1);
    expect(ehAws(chamadas[0].url)).toBe(true);
  });
});

describe("Vigia", () => {
  const quadro = (): Quadro => ({
    hora_local: 5,
    dia_semana: 4,
    plataforma: { gateways: 2, gateways_no_ar: 1, academias_com_gateway: 1 },
    academias: [{ academia: "A1", gateways: 2, gateways_no_ar: 1 }],
    anomalias: [{ id: 1, tipo: "gateway_sem_sinal", academia: "A1", gateway: "G1", minutos: 25, dentro_do_horario: true }],
    vigia: [],
  });
  const analise = { diagnostico: "O Gateway G1 está sem sinal.", causa_provavel: "indeterminada", gravidade: "media", confianca: 60, acoes: [] };

  it("sucesso na Anthropic: a ferramenta de análise volta no formato que o Vigia já lia", async () => {
    const chamadas = simular(
      json({
        content: [{ type: "tool_use", id: "toolu_1", name: NOME_FERRAMENTA_ANALISE, input: analise }],
        usage: { input_tokens: 900, output_tokens: 120 },
        stop_reason: "tool_use",
      }),
    );
    const r = await consultarVigia(env(LIGADO), quadro());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modelo).toBe(MODELO_VIGIA_API);
    expect([r.tokensEntrada, r.tokensSaida]).toEqual([900, 120]);
    expect(interpretarResposta(r.resposta, quadro())).toMatchObject({ ok: true, analise: { diagnostico: analise.diagnostico } });
    expect(chamadas).toHaveLength(1);
    const corpo = chamadas[0].corpo as { model: string; tools: { name: string; input_schema: { type: string } }[]; tool_choice: unknown };
    expect(corpo.model).toBe("claude-sonnet-4-6");
    expect(corpo.tools.map((t) => [t.name, t.input_schema.type])).toEqual([[NOME_FERRAMENTA_ANALISE, "object"]]);
    expect(corpo.tool_choice).toEqual({ type: "tool", name: NOME_FERRAMENTA_ANALISE });
  });

  it("crédito esgotado: a reserva na AWS, com o modelo de sempre", async () => {
    const chamadas = simular(
      creditoEsgotado(),
      json({ output: { message: { content: [{ toolUse: { name: NOME_FERRAMENTA_ANALISE, input: analise } }] } }, usage: { inputTokens: 1, outputTokens: 1 } }),
    );
    const r = await consultarVigia(env(LIGADO), quadro());
    expect(r.ok && r.modelo).toBe(MODELO_VIGIA);
    expect(chamadas.map((c) => c.url === API)).toEqual([true, false]);
    expect(chamadas[1].url).toContain(encodeURIComponent(MODELO_VIGIA));
  });

  it("sem a chave, ou fora da lista: só a AWS", async () => {
    for (const vars of [{ ...AWS, IA_ANTHROPIC_AGENTES: "vigia" }, { ...LIGADO, IA_ANTHROPIC_AGENTES: "assistente" }]) {
      const chamadas = simular(json({ output: { message: { content: [] } } }));
      await consultarVigia(env(vars), quadro());
      expect(chamadas).toHaveLength(1);
      expect(ehAws(chamadas[0].url)).toBe(true);
    }
  });

  it("quadro que não passa na validação não vai a lugar nenhum, nem à Anthropic", async () => {
    const chamadas = simular();
    const sujo = { ...quadro(), observacao: "texto livre" };
    expect(await consultarVigia(env(LIGADO), sujo)).toMatchObject({ ok: false, motivo: "recusada_validacao" });
    expect(chamadas).toEqual([]);
  });
});

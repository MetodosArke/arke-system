import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVENTOS_DO_WEBHOOK,
  gerarTokenWebhook,
  hashDoTokenWebhook,
  iguaisEmTempoConstante,
  registrarWebhookNaConta,
  tokenWebhookValido,
  urlDoWebhookDaAcademia,
} from "../../supabase/functions/_shared/webhookAcademia";
import {
  escopoDoAvisoDaAcademia,
  organizacaoDoEndereco,
  referenciaDaContaDaAcademia,
} from "../../supabase/functions/asaas-webhook/fluxo";

/**
 * O webhook que a ArkeFit registra na conta da academia (cobrança na conta da
 * academia, 06/10/2026): o token cumpre as regras do Asaas, o banco guarda só
 * o hash, o registro não duplica, e o aviso que chega por ele só mexe em
 * cobrança daquela academia que mora na conta dela.
 */

afterEach(() => vi.unstubAllGlobals());

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALUNO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("o token do webhook", () => {
  it("segue as regras do Asaas: 32 a 255 caracteres, sem espaço, sem série, sem sequência numérica, sem ser chave", () => {
    expect(tokenWebhookValido("Ab".repeat(16))).toBe(true);
    expect(tokenWebhookValido("Ab".repeat(15))).toBe(false); // 30
    expect(tokenWebhookValido("A".repeat(256))).toBe(false);
    expect(tokenWebhookValido(`${"Ab".repeat(16)} x`)).toBe(false);
    expect(tokenWebhookValido(`${"Ab".repeat(16)}aaa`)).toBe(false);
    expect(tokenWebhookValido(`${"Ab".repeat(16)}123`)).toBe(false);
    expect(tokenWebhookValido(`${"Ab".repeat(16)}987`)).toBe(false);
    expect(tokenWebhookValido(`$aact_${"Ab".repeat(16)}`)).toBe(false);
  });

  it("o sorteado cumpre as regras e não se repete", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => gerarTokenWebhook()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(tokenWebhookValido(t), t).toBe(true);
  });

  it("sorteia de novo quando o sorteio não serve, e desiste em vez de entregar token fraco", () => {
    let vez = 0;
    // Primeiro sorteio: tudo zero ("AAAA..."), série; depois, bytes que variam.
    const t = gerarTokenWebhook((b) => {
      vez++;
      for (let i = 0; i < b.length; i++) b[i] = vez === 1 ? 0 : (i * 7 + vez) % 224;
      return b;
    });
    expect(vez).toBeGreaterThan(1);
    expect(tokenWebhookValido(t)).toBe(true);
    expect(() => gerarTokenWebhook((b) => b.fill(0))).toThrow();
  });

  it("o banco guarda o SHA-256 em hexadecimal", async () => {
    expect(await hashDoTokenWebhook("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(iguaisEmTempoConstante("abc", "abc")).toBe(true);
    expect(iguaisEmTempoConstante("abc", "abd")).toBe(false);
    expect(iguaisEmTempoConstante("abc", "abcd")).toBe(false);
  });

  it("o endereço leva a academia em ?org=", () => {
    expect(urlDoWebhookDaAcademia("https://x.supabase.co/", ORG)).toBe(`https://x.supabase.co/functions/v1/asaas-webhook?org=${ORG}`);
    expect(organizacaoDoEndereco(urlDoWebhookDaAcademia("https://x.supabase.co", ORG))).toEqual({ org: ORG });
    expect(organizacaoDoEndereco("https://x.supabase.co/functions/v1/asaas-webhook")).toEqual({ org: null });
    expect(organizacaoDoEndereco("https://x/functions/v1/asaas-webhook?org=nao-e-uuid")).toEqual({ invalido: true });
  });
});

describe("o registro na conta da academia", () => {
  type Chamada = { url: string; metodo: string; corpo: Record<string, unknown> | null };
  function fetchFalso(existentes: { id: string; url: string }[]) {
    const chamadas: Chamada[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const c = { url, metodo: init.method ?? "GET", corpo: init.body ? JSON.parse(String(init.body)) : null };
      chamadas.push(c);
      const corpo = c.metodo === "GET" ? { data: existentes } : { id: c.metodo === "POST" ? "wh_novo" : "wh_velho" };
      return new Response(JSON.stringify(corpo), { status: 200 });
    });
    return chamadas;
  }
  const url = urlDoWebhookDaAcademia("https://x.supabase.co", ORG);
  const token = "Ab".repeat(20);

  it("cria com os eventos de cobrança, em ordem, e o token", async () => {
    const chamadas = fetchFalso([]);
    expect(await registrarWebhookNaConta("https://api", "k", { url, token })).toEqual({ ok: true, id: "wh_novo", atualizado: false });
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.url).toBe("https://api/webhooks");
    expect(post.corpo).toMatchObject({ url, authToken: token, sendType: "SEQUENTIALLY", enabled: true, interrupted: false, apiVersion: 3 });
    expect(post.corpo?.events).toEqual([...EVENTOS_DO_WEBHOOK]);
  });

  it("registrar de novo atualiza o mesmo webhook (token novo, fila destravada), sem criar outro", async () => {
    const chamadas = fetchFalso([{ id: "wh_velho", url }, { id: "wh_outro", url: "https://outro" }]);
    expect(await registrarWebhookNaConta("https://api", "k", { url, token })).toEqual({ ok: true, id: "wh_velho", atualizado: true });
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    const put = chamadas.find((c) => c.metodo === "PUT")!;
    expect(put.url).toBe("https://api/webhooks/wh_velho");
    expect(put.corpo).toMatchObject({ authToken: token, interrupted: false });
    // O PUT do Asaas não aceita email nem apiVersion.
    expect(put.corpo).not.toHaveProperty("email");
    expect(put.corpo).not.toHaveProperty("apiVersion");
  });

  it("token fora das regras nem sai daqui", async () => {
    const chamadas = fetchFalso([]);
    expect(await registrarWebhookNaConta("https://api", "k", { url, token: "curto" })).toMatchObject({ ok: false });
    expect(chamadas).toEqual([]);
  });
});

describe("o aviso que vem da conta da academia", () => {
  const base = {
    orgDoToken: ORG,
    referencia: `plano:${ALUNO}`,
    organizacoes: [ORG],
    tocaB2b: false,
    tocaMetodo: false,
    contasDasCobrancas: ["academia"],
  };

  it("mexe na mensalidade e na avulsa daquela academia, que moram na conta dela", () => {
    expect(escopoDoAvisoDaAcademia(base)).toEqual({ ok: true });
    expect(escopoDoAvisoDaAcademia({ ...base, referencia: `avulsa:${ALUNO}` })).toEqual({ ok: true });
    // A primeira notícia de uma mensalidade ainda não tem linha: sem contas, vale.
    expect(escopoDoAvisoDaAcademia({ ...base, contasDasCobrancas: [] })).toEqual({ ok: true });
  });

  it("não alcança outra academia, o Método, o B2B, nem a cobrança que mora na conta da ArkeFit", () => {
    expect(escopoDoAvisoDaAcademia({ ...base, organizacoes: [ORG, OUTRA] })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:organizacao" });
    expect(escopoDoAvisoDaAcademia({ ...base, organizacoes: [] })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:organizacao" });
    expect(escopoDoAvisoDaAcademia({ ...base, tocaMetodo: true })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:metodo" });
    expect(escopoDoAvisoDaAcademia({ ...base, tocaB2b: true })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:b2b" });
    expect(escopoDoAvisoDaAcademia({ ...base, contasDasCobrancas: ["academia", "arkefit"] })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:conta" });
    expect(escopoDoAvisoDaAcademia({ ...base, contasDasCobrancas: [null] })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:conta" });
  });

  it("referência que não é mensalidade nem avulsa do ARKE não é da conta da academia", () => {
    for (const ref of [`metodo:${ALUNO}`, `b2b:${ORG}`, `org:${ORG}`, "pedido-123", null, ""]) {
      expect(referenciaDaContaDaAcademia(ref), String(ref)).toBe(false);
      expect(escopoDoAvisoDaAcademia({ ...base, referencia: ref })).toEqual({ ok: false, resultado: "fora_da_conta_da_academia:referencia" });
    }
  });
});

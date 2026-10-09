import { resumoDoErro } from "./resumoDoErro.ts";

// A API da Anthropic, só para os dois agentes que já rodavam fora do Brasil
// sem dado de aluno: o Vigia (telemetria técnica) e o assistente da academia
// (dúvida de uso do painel, sem identificação). Decisão do responsável de
// 09/10/2026: usar o crédito mensal da API, com a AWS de reserva.
//
// **Quem pode chegar aqui:** só `_shared/ia.ts`, e lá só a porta do Vigia
// (depois de `validarQuadro`) e a do assistente (depois de
// `montarEntrada`). O Sentinela, a dieta em PDF e a Letícia lidam com dado de
// aluno e ficam no Bedrock em São Paulo. `iaAnthropic.guarda.test.ts` cobra:
// nenhum outro arquivo das funções importa este módulo, lê a chave ou chama a
// API.
//
// **O interruptor é por agente, sem deploy:** o segredo `IA_ANTHROPIC_AGENTES`
// (lista separada por vírgula: `vigia`, `assistente`). Sem a chave
// `ANTHROPIC_API_KEY`, ou com o agente fora da lista, nada sai daqui e o
// agente chama o Bedrock exatamente como antes.
//
// **A AWS é a reserva:** qualquer falha daqui (crédito esgotado, chave
// recusada, limite, sobrecarga, erro do servidor, rede, prazo, resposta
// ilegível) devolve `ok: false`, e quem chamou segue para o Bedrock. O log
// leva só o agente e o status HTTP, ou `resumoDoErro`; nunca o corpo, que
// pode trazer o prompt.
//
// O pedido chega no formato do Bedrock (Converse), o mesmo que o agente já
// montava, e a resposta volta nesse formato: o roteiro, a entrada e a leitura
// da resposta são os mesmos nos dois caminhos.

export const AGENTES_ANTHROPIC = ["vigia", "assistente"] as const;
export type AgenteAnthropic = (typeof AGENTES_ANTHROPIC)[number];

const URL_API = "https://api.anthropic.com/v1/messages";
const VERSAO_API = "2023-06-01";

type Env = (n: string) => string | undefined;

/** Se o agente vai à API da Anthropic: a chave existe e ele está na lista. */
export function agenteNaAnthropic(env: Env, agente: AgenteAnthropic): boolean {
  if (!env("ANTHROPIC_API_KEY")?.trim()) return false;
  const lista = (env("IA_ANTHROPIC_AGENTES") ?? "").split(",").map((s) => s.trim().toLowerCase());
  return (AGENTES_ANTHROPIC as readonly string[]).includes(agente) && lista.includes(agente);
}

/** O pedido no formato Converse do Bedrock, como `ia.ts` monta. */
export type PedidoConverse = {
  system: { text: string }[];
  messages: { role: string; content: { text: string }[] }[];
  inferenceConfig: { maxTokens: number; temperature?: number };
  toolConfig?: {
    tools: { toolSpec: { name: string; description?: string; inputSchema: { json: unknown } } }[];
    toolChoice?: { tool?: { name: string } };
  };
};

/** A resposta no formato Converse, para quem já lia o Bedrock ler igual. */
export type RespostaConverse = {
  output: { message: { role: "assistant"; content: ({ text: string } | { toolUse: { toolUseId: string; name: string; input: unknown } })[] } };
  usage: { inputTokens: number | null; outputTokens: number | null };
  stopReason: string | null;
};

/** Converse → Messages API. */
export function paraMessages(modelo: string, p: PedidoConverse) {
  return {
    model: modelo,
    max_tokens: p.inferenceConfig.maxTokens,
    ...(p.inferenceConfig.temperature !== undefined ? { temperature: p.inferenceConfig.temperature } : {}),
    system: p.system.map((s) => s.text).join("\n\n"),
    messages: p.messages.map((m) => ({ role: m.role, content: m.content.map((c) => c.text).join("\n\n") })),
    ...(p.toolConfig
      ? {
          tools: p.toolConfig.tools.map(({ toolSpec }) => ({
            name: toolSpec.name,
            ...(toolSpec.description ? { description: toolSpec.description } : {}),
            input_schema: toolSpec.inputSchema.json,
          })),
          ...(p.toolConfig.toolChoice?.tool ? { tool_choice: { type: "tool", name: p.toolConfig.toolChoice.tool.name } } : {}),
        }
      : {}),
  };
}

/** Messages API → Converse. `null` quando a resposta não tem o formato esperado. */
export function deMessages(r: unknown): RespostaConverse | null {
  const corpo = r as {
    content?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
    stop_reason?: unknown;
  } | null;
  if (!corpo || !Array.isArray(corpo.content)) return null;
  const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const content: RespostaConverse["output"]["message"]["content"] = [];
  for (const bloco of corpo.content as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown }[]) {
    if (bloco?.type === "text" && typeof bloco.text === "string") content.push({ text: bloco.text });
    else if (bloco?.type === "tool_use" && typeof bloco.name === "string") {
      content.push({ toolUse: { toolUseId: typeof bloco.id === "string" ? bloco.id : "", name: bloco.name, input: bloco.input } });
    }
  }
  return {
    output: { message: { role: "assistant", content } },
    usage: { inputTokens: numero(corpo.usage?.input_tokens), outputTokens: numero(corpo.usage?.output_tokens) },
    stopReason: typeof corpo.stop_reason === "string" ? corpo.stop_reason : null,
  };
}

export type TentativaAnthropic =
  | { tentou: false }
  | { tentou: true; ok: true; resposta: RespostaConverse }
  | { tentou: true; ok: false };

/**
 * Chama a API da Anthropic para o agente, se ele estiver ligado nela. Nunca
 * lança: a falha devolve `ok: false`, e quem chamou vai ao Bedrock.
 *
 * `prazoMs` é só desta tentativa: quem chama reserva o resto do prazo dele
 * para o Bedrock.
 */
export async function tentarAnthropic(
  env: Env,
  agente: AgenteAnthropic,
  modelo: string,
  pedido: PedidoConverse,
  prazoMs: number,
): Promise<TentativaAnthropic> {
  if (!agenteNaAnthropic(env, agente)) return { tentou: false };

  const cabecalhos: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": env("ANTHROPIC_API_KEY")!.trim(),
    "anthropic-version": VERSAO_API,
  };
  const workspace = env("ANTHROPIC_WORKSPACE_ID")?.trim();
  if (workspace) cabecalhos["anthropic-workspace-id"] = workspace;

  let resposta: Response;
  try {
    resposta = await fetch(URL_API, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify(paraMessages(modelo, pedido)),
      signal: AbortSignal.timeout(prazoMs),
    });
  } catch (erro) {
    console.error("anthropic: sem resposta, reserva na AWS", agente, resumoDoErro(erro));
    return { tentou: true, ok: false };
  }
  if (!resposta.ok) {
    // 400 com crédito esgotado, 401/403 de chave, 429 de limite, 529 de
    // sobrecarga, 5xx: todos vão à reserva. O corpo não entra no log.
    await resposta.body?.cancel().catch(() => {});
    console.error("anthropic: recusou, reserva na AWS", agente, resposta.status);
    return { tentou: true, ok: false };
  }
  const convertida = deMessages(await resposta.json().catch(() => null));
  if (!convertida) {
    console.error("anthropic: resposta ilegível, reserva na AWS", agente);
    return { tentou: true, ok: false };
  }
  return { tentou: true, ok: true, resposta: convertida };
}

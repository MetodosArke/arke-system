// Cliente de LLM do Arke — fala diretamente com a API da OpenAI.
//
// CLAUDE.md §3: "Sem dependências da plataforma Manus... forge.manus.ai" —
// esta versão substitui o cliente anterior, que tinha fallback fixo para
// "https://forge.manus.im/v1/chat/completions" (resquício do piloto Manus,
// nunca de fato usado por nenhum outro arquivo do projeto até a Fase 16).
// CLAUDE.md §8: "motor de IA será OpenAI, não Gemini" — chave de produção
// já fornecida como variável de ambiente OPENAI_API_KEY.

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type MessageContent = string | TextContent | ImageContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type InvokeParams = {
  messages: Message[];
  outputSchema?: OutputSchema;
  responseFormat?: ResponseFormat;
  model?: string;
  maxTokens?: number;
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const ensureArray = (value: MessageContent | MessageContent[]): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (part: MessageContent): TextContent | ImageContent => {
  if (typeof part === "string") return { type: "text", text: part };
  return part;
};

const normalizeMessage = (message: Message) => {
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role: message.role, name: message.name, content: contentParts[0].text };
  }
  return { role: message.role, name: message.name, content: contentParts };
};

const normalizeResponseFormat = ({ responseFormat, outputSchema }: { responseFormat?: ResponseFormat; outputSchema?: OutputSchema }): ResponseFormat | undefined => {
  if (responseFormat) return responseFormat;
  if (!outputSchema) return undefined;
  if (!outputSchema.name || !outputSchema.schema) throw new Error("outputSchema requires both name and schema");
  return { type: "json_schema", json_schema: { name: outputSchema.name, schema: outputSchema.schema, strict: outputSchema.strict ?? true } };
};

const DEFAULT_MODEL = "gpt-4o-mini";
const RETRY_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function assertApiKey() {
  if (!openaiConfigured()) throw new Error("OPENAI_API_KEY não configurada.");
}

async function fetchWithBackoff(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === RETRY_MAX_RETRIES) return response;
      try { await response.body?.cancel(); } catch { /* já resolvido */ }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao chamar a OpenAI após esgotar as tentativas.");
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();
  const payload: Record<string, unknown> = {
    model: params.model ?? DEFAULT_MODEL,
    messages: params.messages.map(normalizeMessage),
  };
  const responseFormat = normalizeResponseFormat(params);
  if (responseFormat) payload.response_format = responseFormat;
  if (typeof params.maxTokens === "number") payload.max_tokens = params.maxTokens;

  const response = await fetchWithBackoff("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new Error(`OpenAI invoke failed: ${response.status} ${response.statusText} – ${await response.text()}`);
  return (await response.json()) as InvokeResult;
}

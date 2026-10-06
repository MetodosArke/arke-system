/**
 * O webhook que a ArkeFit registra na conta Asaas da academia, quando a
 * cobrança passa a sair da conta dela (`organizations.cobranca_conta_academia`).
 *
 * Por que um webhook por academia: a cobrança feita na conta da academia gera
 * os avisos lá, e não na conta da ArkeFit. Sem um webhook na conta dela, o
 * pagamento confirmado não chega ao ARKE, e o aluno que pagou fica bloqueado.
 *
 * O aviso vem para `asaas-webhook?org=<id>`, com um token próprio da academia.
 * O banco guarda só o hash (`asaas_webhook_academia.token_hash`): o token em
 * claro vai uma vez ao Asaas, no registro, e não volta — o Asaas não devolve
 * o token na leitura (só `hasAuthToken`). Perder o token é registrar de novo,
 * o que troca token e hash juntos.
 *
 * As regras do token são as do Asaas desde 02/03/2026 (validação de
 * complexidade): de 32 a 255 caracteres, sem espaço, sem sequência numérica,
 * sem caractere repetido em série, e não pode ser uma chave de API.
 *
 * Sem Deno e sem Supabase, como os `fluxo.ts`: o teste do app e o sandbox
 * (`npm run sandbox:conta-academia`) exercitam este código, e não uma cópia.
 */

/** Os avisos de cobrança que o `asaas-webhook` trata, e só eles. */
export const EVENTOS_DO_WEBHOOK = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
] as const;

/** Nome do webhook na conta da academia: é por ele (e pela URL) que o registro é achado de novo. */
export const NOME_DO_WEBHOOK = "ArkeFit — cobranças do ARKE";

/** Para onde o Asaas manda o aviso de falha do webhook (fila interrompida). */
export const EMAIL_DO_WEBHOOK = "suporte@arkefit.com.br";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TAMANHO = 48;

/**
 * O token cumpre as regras do Asaas? Sequência numérica é qualquer trecho de
 * três dígitos seguidos em ordem (123, 987); série é o mesmo caractere três
 * vezes seguidas. As duas são mais rígidas que o exemplo do Asaas, de
 * propósito: o token é sorteado, e sortear de novo não custa nada.
 */
export function tokenWebhookValido(token: string): boolean {
  if (token.length < 32 || token.length > 255) return false;
  if (/\s/.test(token)) return false;
  if (/^\$?aact_/.test(token)) return false;
  if (/(.)\1\1/.test(token)) return false;
  for (let i = 0; i + 2 < token.length; i++) {
    const [a, b, c] = [token.charCodeAt(i), token.charCodeAt(i + 1), token.charCodeAt(i + 2)];
    const digitos = [a, b, c].every((x) => x >= 48 && x <= 57);
    if (digitos && ((b === a + 1 && c === b + 1) || (b === a - 1 && c === b - 1))) return false;
  }
  return true;
}

/**
 * Sorteia um token pelo gerador criptográfico (`aleatorio.guarda`), e
 * sorteia de novo até cumprir as regras. O alfabeto deixa de fora 0, 1, I, l
 * e O, que se confundem quando alguém precisa ler o token num painel.
 */
export function gerarTokenWebhook(sortear: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  // Sem viés: só valem os bytes abaixo do maior múltiplo do alfabeto (224 = 56 × 4).
  const limite = 256 - (256 % ALFABETO.length);
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    let token = "";
    for (const byte of sortear(new Uint8Array(TAMANHO * 2))) {
      if (byte >= limite) continue;
      token += ALFABETO[byte % ALFABETO.length];
      if (token.length === TAMANHO) break;
    }
    if (token.length === TAMANHO && tokenWebhookValido(token)) return token;
  }
  throw new Error("não foi possível sortear um token de webhook válido");
}

/** SHA-256 do token, em hexadecimal: é o que o banco guarda e o webhook compara. */
export async function hashDoTokenWebhook(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante: a diferença de tempo não diz quantos caracteres bateram. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let resultado = 0;
  for (let i = 0; i < bufA.length; i++) resultado |= bufA[i] ^ bufB[i];
  return resultado === 0;
}

/** O endereço que o Asaas chama para esta academia. */
export function urlDoWebhookDaAcademia(supabaseUrl: string, organizationId: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/asaas-webhook?org=${encodeURIComponent(organizationId)}`;
}

type WebhookAsaas = { id: string; url?: string; name?: string; enabled?: boolean; interrupted?: boolean; hasAuthToken?: boolean };
type Resposta<T> = { ok: boolean; status: number; corpo: T & { errors?: { description?: string }[] } };

async function chamar<T>(api: string, chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  const resp = await fetch(`${api}${caminho}`, {
    method: metodo,
    headers: { access_token: chave, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }), "User-Agent": "arke" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(20_000),
  });
  let json: unknown = {};
  try {
    json = await resp.json();
  } catch {
    // corpo vazio ou não-JSON: fica {}.
  }
  return { ok: resp.ok, status: resp.status, corpo: json as Resposta<T>["corpo"] };
}

const descricaoErro = (corpo: { errors?: { description?: string }[] }) =>
  corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;

/** O webhook da ArkeFit já registrado nesta conta (pela URL), se houver. */
export async function webhookRegistrado(api: string, chave: string, url: string): Promise<WebhookAsaas | null> {
  const r = await chamar<{ data?: WebhookAsaas[] }>(api, chave, "GET", "/webhooks?limit=100");
  if (!r.ok) throw new Error(descricaoErro(r.corpo) ?? `a lista de webhooks respondeu ${r.status}`);
  return (r.corpo.data ?? []).find((w) => w.url === url) ?? null;
}

export type ResultadoRegistro = { ok: true; id: string; atualizado: boolean } | { ok: false; erro: string };

/**
 * Registra o webhook na conta da academia, ou atualiza o que já existe para a
 * mesma URL — com o token novo, ligado e com a fila destravada. Repetir é
 * seguro: nunca cria dois para a mesma academia (o Asaas aceita até dez por
 * conta, e dois mandariam cada aviso duas vezes).
 *
 * `enabled: false` serve ao sandbox, que exercita o registro sem receber aviso.
 */
export async function registrarWebhookNaConta(
  api: string,
  chave: string,
  dados: { url: string; token: string; email?: string; enabled?: boolean },
): Promise<ResultadoRegistro> {
  if (!tokenWebhookValido(dados.token)) return { ok: false, erro: "token do webhook fora das regras do Asaas" };
  const corpo = {
    name: NOME_DO_WEBHOOK,
    url: dados.url,
    enabled: dados.enabled ?? true,
    interrupted: false,
    authToken: dados.token,
    // Em ordem: a confirmação não chega antes da emissão.
    sendType: "SEQUENTIALLY",
    events: [...EVENTOS_DO_WEBHOOK],
  };
  let existente: WebhookAsaas | null;
  try {
    existente = await webhookRegistrado(api, chave, dados.url);
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "não foi possível ler os webhooks da conta" };
  }
  if (existente) {
    const r = await chamar<WebhookAsaas>(api, chave, "PUT", `/webhooks/${encodeURIComponent(existente.id)}`, corpo);
    if (!r.ok) return { ok: false, erro: descricaoErro(r.corpo) ?? `o Asaas não atualizou o webhook (HTTP ${r.status})` };
    return { ok: true, id: existente.id, atualizado: true };
  }
  const r = await chamar<WebhookAsaas>(api, chave, "POST", "/webhooks", {
    ...corpo,
    email: dados.email ?? EMAIL_DO_WEBHOOK,
    apiVersion: 3,
  });
  if (!r.ok || !r.corpo.id) return { ok: false, erro: descricaoErro(r.corpo) ?? `o Asaas não criou o webhook (HTTP ${r.status})` };
  return { ok: true, id: r.corpo.id, atualizado: false };
}

/** Remove o webhook (o sandbox limpa o que criou). 404 conta como removido. */
export async function removerWebhook(api: string, chave: string, id: string): Promise<boolean> {
  const r = await chamar<{ deleted?: boolean }>(api, chave, "DELETE", `/webhooks/${encodeURIComponent(id)}`);
  return r.ok || r.status === 404;
}

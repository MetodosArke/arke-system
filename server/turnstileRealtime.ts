// Sinalização nuvem → agente local de catraca (D-B1, CLAUDE.md §4/§8.4):
// usa o endpoint REST de Broadcast do Supabase Realtime em vez de abrir um
// WebSocket no backend — a Vercel roda como função serverless (sem
// processo persistente), então quem mantém a conexão WebSocket aberta e
// escuta o canal `turnstile:{deviceId}` é o agente local (fora deste
// repositório), não a nuvem.
//
// Simplificação assumida nesta fatia: o canal não usa autorização por RLS
// do Supabase Realtime (o que exigiria configurar policies em
// `realtime.messages` e emitir um JWT por dispositivo/organização) — o
// UUID do dispositivo já funciona como capability token de baixo risco: o
// comando entregue por esse canal é só um sinal ("teste sua conexão"),
// nunca uma decisão de acesso. A decisão de acesso real e qualquer escrita
// de status continuam exigindo CATRACA_API_KEY no contrato HTTP
// (POST /api/v1/access/heartbeat e /test-result), o mesmo padrão já usado
// pelo check-in. Reforçar a autorização do canal fica para quando houver
// agente real em campo para validar contra.
function config() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado.");
  return { url: url.replace(/\/$/, ""), key };
}

export function turnstileChannel(deviceId: string) {
  return `turnstile:${deviceId}`;
}

// Sem timeout, um travamento do endpoint de broadcast do Supabase Realtime
// deixava a chamada de "testar conexão" pendurada indefinidamente até o
// timeout da própria função serverless — a UI nunca mostrava um erro claro
// antes disso.
const BROADCAST_TIMEOUT_MS = 8000;

export async function publishTurnstileBroadcast(deviceId: string, event: string, payload: Record<string, unknown>) {
  const { url, key } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BROADCAST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: turnstileChannel(deviceId), event, payload }] }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Supabase Realtime ${response.status}: ${await response.text()}`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Supabase Realtime não respondeu a tempo.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

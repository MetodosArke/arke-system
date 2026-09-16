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

export async function publishTurnstileBroadcast(deviceId: string, event: string, payload: Record<string, unknown>) {
  const { url, key } = config();
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: turnstileChannel(deviceId), event, payload }] }),
  });
  if (!response.ok) throw new Error(`Supabase Realtime ${response.status}: ${await response.text()}`);
}

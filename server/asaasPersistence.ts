type Json = Record<string, unknown>;

export type AsaasPaymentRow = { id: string; asaas_id: string; organization_id: string | null; customer_id: string | null; value: number | null; billing_type: string | null; due_date: string | null; status: string | null; invoice_url: string | null; bank_slip_url: string | null; created_at: string; updated_at: string };

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado.");
  return { url, key };
}

async function supabaseRequest<T>(table: string, init: RequestInit = {}, query = "") {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

export async function persistAsaasEvent(input: { eventId: string; event: string; occurredAt?: string; payload: Json }) {
  try {
    await supabaseRequest("asaas_webhook_events", { method: "POST", body: JSON.stringify({ event_id: input.eventId, event: input.event, occurred_at: input.occurredAt ?? new Date().toISOString(), payload: input.payload }) });
    return { duplicate: false };
  } catch (error) {
    // Checa a constraint específica (não só "409"/"23505" genérico, que
    // tratava qualquer outro conflito futuro como se já fosse este evento
    // processado, pulando upsertAsaasPayment sem nunca ter persistido nada).
    if (String(error).includes("asaas_webhook_events_event_id_key")) return { duplicate: true };
    throw error;
  }
}

// PAYMENT_DELETED e PAYMENT_PARTIALLY_REFUNDED são os dois eventos assinados
// (ver createAsaasWebhook) em que o campo `payment.status` do Asaas não
// necessariamente reflete essa mudança — sem isso, o financeiro continuava
// contando uma cobrança estornada/apagada como pendente ou recebida.
// PAYMENT_RESTORED (desfaz um delete) não precisa de override: o próprio
// payment.status já volta a refletir o estado real quando isso acontece.
const EVENT_STATUS_OVERRIDE: Record<string, string> = {
  PAYMENT_DELETED: "DELETED",
  PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

export async function upsertAsaasPayment(payment: Json, event: string, organizationId?: string) {
  const asaasId = String(payment.id ?? "");
  if (!asaasId) return;
  // organizationId só é enviado na criação (via createSubscriptionCharge). Uma
  // atualização vinda do webhook não inclui essa coluna no body, então o
  // merge-duplicates preserva o organization_id já persistido em vez de
  // sobrescrevê-lo com null.
  const status = EVENT_STATUS_OVERRIDE[event] ?? (payment.status as string | undefined) ?? event;
  await supabaseRequest("asaas_payments", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ asaas_id: asaasId, ...(organizationId ? { organization_id: organizationId } : {}), customer_id: payment.customer ?? null, value: payment.value ?? null, billing_type: payment.billingType ?? null, due_date: payment.dueDate ?? null, status, invoice_url: payment.invoiceUrl ?? null, bank_slip_url: payment.bankSlipUrl ?? null, raw_payload: payment, updated_at: new Date().toISOString() }) }, "?on_conflict=asaas_id");
}

export async function listAsaasPaymentsForOrganization(organizationId: string, limit = 20) {
  return supabaseRequest<AsaasPaymentRow[]>("asaas_payments", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=updated_at.desc&limit=${limit}`);
}

// Painel de negócio ArkeFit (Sessão C): financeiro cross-organização — o
// que cada cliente deve à Arke (mensalidade, módulo Arke, taxa de setup),
// todos já registrados em asaas_payments via upsertAsaasPayment. Mesma
// ressalva de listAllOrganizationsForPlatform em server/db.ts: só para uso
// atrás de adminProcedure.
export async function listAllAsaasPayments(input: { status?: string; limit?: number } = {}) {
  if (!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))) return [];
  const limit = input.limit ?? 200;
  const statusFilter = input.status ? `&status=eq.${encodeURIComponent(input.status)}` : "";
  return supabaseRequest<AsaasPaymentRow[]>("asaas_payments", {}, `?select=*&order=updated_at.desc&limit=${limit}${statusFilter}`);
}

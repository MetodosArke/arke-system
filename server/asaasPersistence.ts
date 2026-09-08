type Json = Record<string, unknown>;

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
    if (String(error).includes("409") || String(error).includes("23505")) return { duplicate: true };
    throw error;
  }
}

export async function upsertAsaasPayment(payment: Json, event: string) {
  const asaasId = String(payment.id ?? "");
  if (!asaasId) return;
  await supabaseRequest("asaas_payments", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ asaas_id: asaasId, customer_id: payment.customer ?? null, value: payment.value ?? null, billing_type: payment.billingType ?? null, due_date: payment.dueDate ?? null, status: payment.status ?? event, invoice_url: payment.invoiceUrl ?? null, bank_slip_url: payment.bankSlipUrl ?? null, raw_payload: payment, updated_at: new Date().toISOString() }) }, "?on_conflict=asaas_id");
}

export async function listStoredAsaasPayments(limit = 20) {
  return supabaseRequest<Array<Json>>("asaas_payments", {}, `?select=*&order=updated_at.desc&limit=${limit}`);
}

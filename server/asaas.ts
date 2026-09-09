function asaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY ?? "";
  const baseUrl = (process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
  if (!apiKey) throw new Error("ASAAS_API_KEY não configurada.");
  return { apiKey, baseUrl };
}

async function asaasRequest<T>(path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { access_token: apiKey, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Asaas ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export type AsaasCustomer = { id: string; name: string; email?: string; cpfCnpj?: string };
export type AsaasPayment = { id: string; customer: string; value: number; billingType: string; status: string; dueDate: string; invoiceUrl?: string; bankSlipUrl?: string; pixQrCodeId?: string };

export function asaasSandboxConfigured() { return Boolean(process.env.ASAAS_API_KEY); }
export async function getAsaasAccount() { return asaasRequest<{ name: string; email: string; walletId?: string }>("/myAccount"); }
export async function createAsaasCustomer(input: { name: string; email: string; cpfCnpj?: string }) { return asaasRequest<AsaasCustomer>("/customers", { method: "POST", body: JSON.stringify(input) }); }
export async function createAsaasPayment(input: { customer: string; value: number; dueDate: string; billingType: "UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD" | "DEBIT_CARD"; description: string }) { return asaasRequest<AsaasPayment>("/payments", { method: "POST", body: JSON.stringify(input) }); }
export async function listAsaasPayments(limit = 20) { return asaasRequest<{ data: AsaasPayment[] }>(`/payments?limit=${limit}`); }
export async function createAsaasWebhook(input: { url: string; email: string }) {
  const events = ["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"];
  return asaasRequest<{ id: string; url: string; enabled: boolean }>("/webhooks", { method: "POST", body: JSON.stringify({ name: "Arke pagamentos", url: input.url, email: input.email, enabled: true, interrupted: false, authToken: process.env.ASAAS_WEBHOOK_TOKEN, sendType: "SEQUENTIALLY", events }) });
}

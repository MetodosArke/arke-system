// Fases 14 e 15 (CLAUDE.md §9): benefícios (Wellhub/TotalPass) e catraca —
// credenciais que a própria organização informa para o Arke fazer o
// vínculo com a plataforma/equipamento que ela já usa. Nunca uma
// credencial global da Arke: cada organização/unidade tem a sua.
//
// Regra desta camada: o backend nunca devolve o segredo (client_secret,
// app_secret, ou qualquer campo dentro de `config` da catraca, que varia
// por fabricante) em claro para o cliente — só indica se está configurado
// e mostra os campos não sensíveis. Salvar um campo secreto vazio
// preserva o valor já salvo (o formulário não obriga redigitar o segredo
// para trocar só um campo público).

import type { TurnstileBrand } from "@shared/turnstile";
import { TurnstileAdapterFactory } from "./turnstileAdapters";
import { publishTurnstileBroadcast } from "./turnstileRealtime";

type Json = Record<string, unknown>;

function config() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado.");
  return { url: url.replace(/\/$/, ""), key };
}

async function request<T>(table: string, init: RequestInit = {}, query = "") {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

export type BenefitProvider = "wellhub" | "totalpass";
type BenefitRow = { id: string; organization_id: string; provider: BenefitProvider; enabled: boolean; credentials: Record<string, string>; updated_at: string };

const BENEFIT_SECRET_FIELD: Record<BenefitProvider, string> = { wellhub: "client_secret", totalpass: "app_secret" };
const BENEFIT_PUBLIC_FIELDS: Record<BenefitProvider, string[]> = { wellhub: ["client_id", "partner_id"], totalpass: ["app_key", "gym_id"] };

async function getRawBenefitIntegration(organizationId: string, provider: BenefitProvider) {
  const rows = await request<BenefitRow[]>("saas_benefit_integrations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&provider=eq.${provider}&limit=1`);
  return rows[0] ?? null;
}

export async function getBenefitIntegration(organizationId: string, provider: BenefitProvider) {
  const row = await getRawBenefitIntegration(organizationId, provider);
  const credentials = row?.credentials ?? {};
  const publicFields = Object.fromEntries(BENEFIT_PUBLIC_FIELDS[provider].map((field) => [field, credentials[field] ?? ""]));
  return { provider, enabled: row?.enabled ?? false, configured: Boolean(credentials[BENEFIT_SECRET_FIELD[provider]]), publicFields, updatedAt: row?.updated_at ?? null };
}

export async function listBenefitIntegrations(organizationId: string) {
  const [wellhub, totalpass] = await Promise.all([getBenefitIntegration(organizationId, "wellhub"), getBenefitIntegration(organizationId, "totalpass")]);
  return [wellhub, totalpass];
}

export async function saveBenefitIntegration(input: { organizationId: string; provider: BenefitProvider; fields: Record<string, string>; enabled: boolean }) {
  const existing = await getRawBenefitIntegration(input.organizationId, input.provider);
  const secretField = BENEFIT_SECRET_FIELD[input.provider];
  const merged: Record<string, string> = { ...(existing?.credentials ?? {}), ...input.fields };
  if (!input.fields[secretField]) merged[secretField] = existing?.credentials?.[secretField] ?? ""; // não sobrescreve o segredo já salvo com vazio
  await request("saas_benefit_integrations", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, provider: input.provider, enabled: input.enabled, credentials: merged }) }, "?on_conflict=organization_id,provider");
  return getBenefitIntegration(input.organizationId, input.provider);
}

export type { TurnstileBrand };
export type TurnstileCommunicationMode = "cloud_webhook" | "local_agent";
export type TurnstileDeviceStatus = "online" | "offline" | "unknown";
export type TurnstileTestResult = "success" | "failed";
type TurnstileRow = {
  id: string; unit_id: string; organization_id: string; brand: TurnstileBrand; model: string | null;
  model_id: string | null; communication_mode: TurnstileCommunicationMode | null; port: number | null; serial_or_key: string | null;
  status: TurnstileDeviceStatus; last_ping_at: string | null; config: Record<string, string>; enabled: boolean; updated_at: string;
  last_test_requested_at: string | null; last_test_at: string | null; last_test_result: TurnstileTestResult | null; last_test_message: string | null;
  saas_units: { name: string } | null;
};

// Um heartbeat antigo não prova que o equipamento está online agora
// (CLAUDE.md — nunca tratar ausência de sinal recente como se fosse sinal
// positivo): o status exibido é sempre recalculado a partir de
// last_ping_at, nunca só o que ficou gravado na última escrita.
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
function computeStatus(lastPingAt: string | null): TurnstileDeviceStatus {
  if (!lastPingAt) return "unknown";
  return Date.now() - new Date(lastPingAt).getTime() <= HEARTBEAT_STALE_MS ? "online" : "offline";
}

function mapTurnstileRow(row: TurnstileRow) {
  return {
    id: row.id, unitId: row.unit_id, unitName: row.saas_units?.name ?? "Unidade", brand: row.brand, model: row.model,
    modelId: row.model_id, communicationMode: row.communication_mode, port: row.port, serialOrKey: row.serial_or_key,
    status: computeStatus(row.last_ping_at), lastPingAt: row.last_ping_at, enabled: row.enabled, configured: Object.keys(row.config ?? {}).length > 0, updatedAt: row.updated_at,
    lastTestRequestedAt: row.last_test_requested_at, lastTestAt: row.last_test_at, lastTestResult: row.last_test_result, lastTestMessage: row.last_test_message,
  };
}

export async function listTurnstileIntegrationsForOrganization(organizationId: string) {
  const rows = await request<TurnstileRow[]>("turnstile_devices", {}, `?select=*,saas_units(name)&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return rows.map(mapTurnstileRow);
}

export async function saveTurnstileIntegration(input: {
  unitId: string; organizationId: string; brand: TurnstileBrand; model?: string; modelId?: string;
  communicationMode?: TurnstileCommunicationMode; port?: number; serialOrKey?: string; config: Record<string, string>; enabled: boolean;
}) {
  await request("turnstile_devices", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({
    unit_id: input.unitId, organization_id: input.organizationId, brand: input.brand, model: input.model || null,
    model_id: input.modelId || null, communication_mode: input.communicationMode || null, port: input.port ?? null,
    serial_or_key: input.serialOrKey || null, config: input.config, enabled: input.enabled,
  }) }, "?on_conflict=unit_id");
  const rows = await listTurnstileIntegrationsForOrganization(input.organizationId);
  return rows.find((row) => row.unitId === input.unitId);
}

export async function deleteTurnstileIntegration(unitId: string, organizationId: string) {
  await request("turnstile_devices", { method: "DELETE" }, `?unit_id=eq.${encodeURIComponent(unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return { success: true } as const;
}

// Comando "testar conexão" (B2, D-B1): a nuvem nunca alcança o IP local do
// equipamento (Vercel não tem rota para a rede da academia) — só publica o
// sinal no canal Realtime do dispositivo; quem testa de verdade e reporta
// o resultado é o agente local, via POST /api/v1/access/test-result
// (mesmo contrato de autenticação do heartbeat/check-in).
export async function requestTurnstileTestConnection(unitId: string, organizationId: string) {
  const rows = await request<TurnstileRow[]>("turnstile_devices", {}, `?select=*,saas_units(name)&unit_id=eq.${encodeURIComponent(unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  const device = rows[0];
  if (!device) throw new Error("Catraca não configurada para esta unidade.");
  const command = TurnstileAdapterFactory.forBrand(device.brand).buildTestConnectionCommand();
  await publishTurnstileBroadcast(device.id, "command", command);
  const requestedAt = new Date().toISOString();
  await request("turnstile_devices", { method: "PATCH", body: JSON.stringify({ last_test_requested_at: requestedAt }) }, `?id=eq.${encodeURIComponent(device.id)}`);
  return mapTurnstileRow({ ...device, last_test_requested_at: requestedAt });
}

async function getTurnstileDeviceById(deviceId: string) {
  const rows = await request<TurnstileRow[]>("turnstile_devices", {}, `?select=*,saas_units(name)&id=eq.${encodeURIComponent(deviceId)}&limit=1`);
  return rows[0] ?? null;
}

// Heartbeat (B2): o agente local chama periodicamente para provar que
// ainda está de pé — sem isso, o status exibido cai para "offline" depois
// de HEARTBEAT_STALE_MS (ver computeStatus acima).
export async function recordTurnstileHeartbeat(deviceId: string) {
  const device = await getTurnstileDeviceById(deviceId);
  if (!device) return { success: false } as const;
  await request("turnstile_devices", { method: "PATCH", body: JSON.stringify({ status: "online", last_ping_at: new Date().toISOString() }) }, `?id=eq.${encodeURIComponent(deviceId)}`);
  return { success: true } as const;
}

// Resultado do teste de conexão (B2): o agente reporta de volta o que
// encontrou ao testar a rede local dele mesmo — nunca uma inferência da
// nuvem. Sucesso também conta como heartbeat (prova que o agente está
// ativo agora); falha não mexe em status/last_ping_at (são fatos
// diferentes: "não consegui falar com o equipamento agora" não é o mesmo
// que "o agente está offline").
export async function reportTurnstileTestResult(deviceId: string, result: TurnstileTestResult, message?: string) {
  const device = await getTurnstileDeviceById(deviceId);
  if (!device) return { success: false } as const;
  const now = new Date().toISOString();
  const patch: Json = { last_test_at: now, last_test_result: result, last_test_message: message ?? null };
  if (result === "success") { patch.status = "online"; patch.last_ping_at = now; }
  await request("turnstile_devices", { method: "PATCH", body: JSON.stringify(patch) }, `?id=eq.${encodeURIComponent(deviceId)}`);
  return { success: true } as const;
}

// Catálogo global marca/modelo (CLAUDE.md §8.4) — qualquer organização lê
// para escolher marca → modelo no onboarding/configuração; só admin/super_admin
// escreve (RLS espelha isso, service_role passa por cima como defesa em
// profundidade de qualquer forma).
type TurnstileBrandRow = { id: string; slug: TurnstileBrand; name: string };
type TurnstileModelRow = { id: string; brand_id: string; name: string; communication_modes: TurnstileCommunicationMode[]; default_port: number | null; protocol_notes: string | null };

export async function listTurnstileCatalog() {
  const [brands, models] = await Promise.all([
    request<TurnstileBrandRow[]>("turnstile_brands", {}, "?select=*&order=name"),
    request<TurnstileModelRow[]>("turnstile_models", {}, "?select=*&order=name"),
  ]);
  return brands.map((brand) => ({
    id: brand.id, slug: brand.slug, name: brand.name,
    models: models.filter((model) => model.brand_id === brand.id).map((model) => ({ id: model.id, name: model.name, communicationModes: model.communication_modes, defaultPort: model.default_port, protocolNotes: model.protocol_notes })),
  }));
}

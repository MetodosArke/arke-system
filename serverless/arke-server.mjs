// serverless/entry.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
import { z as z2 } from "zod";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var SUPABASE_ACCESS_COOKIE = "arke_supabase_access";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/trpc.ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  }))
});

// server/_core/rateLimit.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
var buckets = /* @__PURE__ */ new Map();
var MAX_BUCKETS = 5e3;
function assertRateLimit(key, max, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new TRPCError2({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
  }
}
function rateLimitKey(req, bucket) {
  const forwardedFor = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0]?.trim() : void 0;
  return `${bucket}:${forwardedFor || req.ip || "unknown"}`;
}

// server/asaas.ts
function asaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY ?? "";
  const baseUrl = (process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
  if (!apiKey) throw new Error("ASAAS_API_KEY n\xE3o configurada.");
  return { apiKey, baseUrl };
}
async function asaasRequest(path, init2 = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const response = await fetch(`${baseUrl}${path}`, { ...init2, headers: { access_token: apiKey, "Content-Type": "application/json", ...init2.headers ?? {} } });
  if (!response.ok) throw new Error(`Asaas ${response.status}: ${await response.text()}`);
  return response.json();
}
function asaasConfigured() {
  return Boolean(process.env.ASAAS_API_KEY);
}
function asaasEnvironment() {
  return (process.env.ASAAS_API_URL ?? "").includes("api-sandbox") || !process.env.ASAAS_API_URL ? "sandbox" : "production";
}
async function getAsaasAccount() {
  return asaasRequest("/myAccount");
}
async function createAsaasCustomer(input) {
  return asaasRequest("/customers", { method: "POST", body: JSON.stringify(input) });
}
async function createAsaasPayment(input) {
  return asaasRequest("/payments", { method: "POST", body: JSON.stringify(input) });
}
async function listAsaasPayments(limit = 20) {
  return asaasRequest(`/payments?limit=${limit}`);
}
async function createAsaasWebhook(input) {
  const events = ["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"];
  return asaasRequest("/webhooks", { method: "POST", body: JSON.stringify({ name: "Arke pagamentos", url: input.url, email: input.email, enabled: true, interrupted: false, authToken: process.env.ASAAS_WEBHOOK_TOKEN, sendType: "SEQUENTIALLY", events }) });
}

// server/asaasPersistence.ts
function supabaseConfig() {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado.");
  return { url, key };
}
async function supabaseRequest(table, init2 = {}, query = "") {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, { ...init2, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init2.headers ?? {} } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
async function persistAsaasEvent(input) {
  try {
    await supabaseRequest("asaas_webhook_events", { method: "POST", body: JSON.stringify({ event_id: input.eventId, event: input.event, occurred_at: input.occurredAt ?? (/* @__PURE__ */ new Date()).toISOString(), payload: input.payload }) });
    return { duplicate: false };
  } catch (error) {
    if (String(error).includes("409") || String(error).includes("23505")) return { duplicate: true };
    throw error;
  }
}
async function upsertAsaasPayment(payment, event, organizationId) {
  const asaasId = String(payment.id ?? "");
  if (!asaasId) return;
  await supabaseRequest("asaas_payments", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ asaas_id: asaasId, ...organizationId ? { organization_id: organizationId } : {}, customer_id: payment.customer ?? null, value: payment.value ?? null, billing_type: payment.billingType ?? null, due_date: payment.dueDate ?? null, status: payment.status ?? event, invoice_url: payment.invoiceUrl ?? null, bank_slip_url: payment.bankSlipUrl ?? null, raw_payload: payment, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, "?on_conflict=asaas_id");
}
async function listAsaasPaymentsForOrganization(organizationId, limit = 20) {
  return supabaseRequest("asaas_payments", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=updated_at.desc&limit=${limit}`);
}

// server/_core/errorMonitoring.ts
import * as Sentry from "@sentry/node";
var initialized = false;
function initErrorMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
  initialized = true;
  process.on("unhandledRejection", (reason) => captureException2(reason));
  process.on("uncaughtException", (error) => captureException2(error));
}
function captureException2(error, extra) {
  console.error(error);
  if (!initialized) return;
  Sentry.captureException(error, extra ? { extra } : void 0);
}

// shared/pricing.ts
var ORG_PLAN_KEYS = ["starter", "growth", "scale"];
var PROFISSIONAL_PLAN_KEYS = ["essencial", "performance", "ilimitado"];
var SAAS_PLAN_KEYS = [...ORG_PLAN_KEYS, ...PROFISSIONAL_PLAN_KEYS];
var ORG_PLAN_LABELS = { starter: "Starter", growth: "Growth", scale: "Scale" };
var PROFISSIONAL_PLAN_LABELS = { essencial: "Essencial", performance: "Performance", ilimitado: "Ilimitado" };
var ORG_PLAN_AMOUNTS_CENTS = { starter: 29900, growth: 69900, scale: 149e3 };
var PROFISSIONAL_PLAN_AMOUNTS_CENTS = { essencial: 7900, performance: 14900, ilimitado: 24900 };
var PLAN_LIMITS = {
  starter: { maxUnits: 1, maxUsers: 12 },
  growth: { maxUnits: 3, maxUsers: 32 },
  scale: { maxUnits: 10, maxUsers: 100 },
  essencial: { maxUnits: 1, maxUsers: 3 },
  performance: { maxUnits: 1, maxUsers: 8 },
  ilimitado: { maxUnits: 1, maxUsers: 999 }
};
var PLAN_AMOUNTS_CENTS = { ...ORG_PLAN_AMOUNTS_CENTS, ...PROFISSIONAL_PLAN_AMOUNTS_CENTS };
var formatBRL = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
var orgPlanOptions = ORG_PLAN_KEYS.map((key) => ({ value: key, label: `${ORG_PLAN_LABELS[key]} \u2014 ${formatBRL(ORG_PLAN_AMOUNTS_CENTS[key])}/m\xEAs` }));
var profissionalPlanOptions = PROFISSIONAL_PLAN_KEYS.map((key) => ({ value: key, label: `${PROFISSIONAL_PLAN_LABELS[key]} \u2014 ${formatBRL(PROFISSIONAL_PLAN_AMOUNTS_CENTS[key])}/m\xEAs` }));
var SETUP_FEE_CENTS = 149e3;
var ARKE_MODULE_PACKAGE_AMOUNTS_CENTS = { starter: 9900, growth: 24900, scale: 49900 };
var ARKE_ALUNO_WHOLESALE_CENTS = 5990;

// server/db.ts
function isConfigured() {
  return Boolean((process.env.SUPABASE_URL ?? "") && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? ""));
}
function config() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}
async function request(table, init2 = {}, query = "") {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init2,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init2.headers ?? {} }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
async function rpc(fn, args) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${await response.text()}`);
  return await response.json();
}
async function getOrganizationsForUser(userId) {
  if (!isConfigured()) return [];
  const rows = await request(
    "saas_memberships",
    {},
    `?select=*,saas_organizations(*)&auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.active`
  );
  return rows.map(({ saas_organizations, ...membership }) => ({ membership, organization: saas_organizations })).sort((a, b) => b.organization.updated_at.localeCompare(a.organization.updated_at));
}
async function getMembership(userId, organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request(
    "saas_memberships",
    {},
    `?select=*,saas_organizations(*)&auth_user_id=eq.${encodeURIComponent(userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`
  );
  const row = rows[0];
  if (!row) return void 0;
  const { saas_organizations, ...membership } = row;
  return { membership, organization: saas_organizations };
}
async function listActiveStaffUserIds(organizationId, allowedRoles) {
  if (!isConfigured()) return [];
  const rolesFilter = allowedRoles.map(encodeURIComponent).join(",");
  const rows = await request("saas_memberships", {}, `?select=auth_user_id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&role=in.(${rolesFilter})`);
  return rows.map((row) => row.auth_user_id);
}
async function getOrganizationBySlug(slug) {
  if (!isConfigured()) return void 0;
  const rows = await request("saas_organizations", {}, `?select=id,name,slug,module,logo_url,primary_color&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0];
}
async function createOrganizationWithOwner(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc("create_organization_with_owner", {
    p_user_id: input.userId,
    p_client_id: input.clientId,
    p_name: input.name,
    p_slug: input.slug,
    p_plan: input.plan,
    p_module: input.module ?? "academia",
    p_logo_url: input.logoUrl ?? null,
    p_primary_color: input.primaryColor ?? null
  });
  if (!result) throw new Error("Falha ao criar organiza\xE7\xE3o");
  return { organizationId: result.organization_id, unitId: result.unit_id };
}
async function createOrganizationInvitation(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request("saas_invitations", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, invited_by_user_id: input.invitedByUserId, email: input.email, role: input.role, token_hash: input.tokenHash, expires_at: input.expiresAt.toISOString() }) });
  return created;
}
async function getPendingOrganizationInvitations(organizationId) {
  if (!isConfigured()) return [];
  return request("saas_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}
async function revokeOrganizationInvitation(id2, organizationId) {
  if (!isConfigured()) throw new Error("Database not available");
  const rows = await request("saas_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite n\xE3o encontrado ou j\xE1 utilizado.");
  return rows[0];
}
async function acceptOrganizationInvitation(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc("accept_organization_invitation", {
    p_token_hash: input.tokenHash,
    p_user_id: input.userId,
    p_email: input.email
  });
  if (!result) throw new Error("Invitation not found or already used");
  return { invitation: { id: result.invitation_id }, organizationId: result.org_id, role: result.role };
}
async function getOrganizationSubscription(organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request("saas_subscriptions", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=1`);
  return rows[0];
}
async function updateOrganizationProfile(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [updated] = await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ name: input.name, ...input.logoUrl !== void 0 ? { logo_url: input.logoUrl } : {}, ...input.primaryColor !== void 0 ? { primary_color: input.primaryColor } : {} }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  return updated;
}
async function updateOrganizationSubscription(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const amountCents = PLAN_AMOUNTS_CENTS[input.plan];
  const limits = PLAN_LIMITS[input.plan];
  await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ plan: input.plan, max_units: limits.maxUnits, max_users: limits.maxUsers }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  await request("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ plan: input.plan, amount_cents: amountCents, ...input.status ? { status: input.status } : {} }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
  return getOrganizationSubscription(input.organizationId);
}
async function getOrganization(organizationId) {
  const rows = await request("saas_organizations", {}, `?select=*&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0];
}
async function getOrCreateAsaasCustomerForOrganization(organizationId) {
  const organization = await getOrganization(organizationId);
  if (!organization) throw new Error("Organiza\xE7\xE3o n\xE3o encontrada.");
  if (organization.asaas_customer_id) return organization.asaas_customer_id;
  const [client] = await request("app_users", {}, `?select=name,email&id=eq.${encodeURIComponent(organization.client_id)}&limit=1`);
  if (!client) throw new Error("Cliente respons\xE1vel pela organiza\xE7\xE3o n\xE3o encontrado.");
  const customer = await createAsaasCustomer({ name: organization.name, email: client.email });
  await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ asaas_customer_id: customer.id }) }, `?id=eq.${encodeURIComponent(organizationId)}`);
  return customer.id;
}
async function createSubscriptionCharge(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const subscription = await getOrganizationSubscription(input.organizationId);
  if (!subscription) throw new Error("Esta organiza\xE7\xE3o n\xE3o tem assinatura ativa.");
  const customerId = await getOrCreateAsaasCustomerForOrganization(input.organizationId);
  const dueDate = input.dueDate ?? new Date(Date.now() + 1e3 * 60 * 60 * 24 * 3).toISOString().slice(0, 10);
  const payment = await createAsaasPayment({ customer: customerId, value: subscription.amount_cents / 100, dueDate, billingType: input.billingType, description: `Mensalidade Arke \u2014 plano ${subscription.plan}` });
  await upsertAsaasPayment(payment, "PAYMENT_CREATED", input.organizationId);
  await request("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ provider: "asaas", external_id: payment.id }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
  return payment;
}
async function chargeSetupFeeIfNeeded(organizationId) {
  if (!isConfigured()) return;
  const organization = await getOrganization(organizationId);
  if (!organization || organization.setup_fee_charged_at) return;
  try {
    const customerId = await getOrCreateAsaasCustomerForOrganization(organizationId);
    const dueDate = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 3).toISOString().slice(0, 10);
    const payment = await createAsaasPayment({ customer: customerId, value: SETUP_FEE_CENTS / 100, dueDate, billingType: "UNDEFINED", description: "Taxa de setup Arke" });
    await upsertAsaasPayment(payment, "PAYMENT_CREATED", organizationId);
    await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ setup_fee_charged_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(organizationId)}`);
  } catch (error) {
    captureException2(error, { route: "onboarding.setupFee", organizationId });
  }
}
async function getOrganizationAccess(userId, organizationId) {
  if (!isConfigured()) return void 0;
  const membership = await getMembership(userId, organizationId);
  if (!membership) return void 0;
  const [units, policies] = await Promise.all([
    request("saas_units", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request("saas_module_policies", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}`)
  ]);
  return { organization: membership.organization, membership: membership.membership, units, policies };
}
async function saveOrganizationOnboarding(input) {
  if (!isConfigured()) throw new Error("Database not available");
  if (input.logoUrl !== void 0 || input.primaryColor !== void 0 || input.defaultUnitName !== void 0) {
    await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ ...input.logoUrl !== void 0 ? { logo_url: input.logoUrl } : {}, ...input.primaryColor !== void 0 ? { primary_color: input.primaryColor } : {}, ...input.defaultUnitName !== void 0 ? { name: input.defaultUnitName } : {} }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  }
  await request("saas_onboarding", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, current_step: input.currentStep, status: input.status, city: input.city ?? null, default_unit_name: input.defaultUnitName ?? null, invite_email: input.inviteEmail ?? null }) }, "?on_conflict=organization_id");
  if (input.status === "completed") await chargeSetupFeeIfNeeded(input.organizationId);
  return { organizationId: input.organizationId, saved: true };
}
async function updateModulePolicy(input) {
  if (!isConfigured()) throw new Error("Database not available");
  await request("saas_module_policies", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId, role: input.role, module: input.module, can_view: input.canView, can_manage: input.canManage }) }, "?on_conflict=organization_id,unit_id,role,module");
  return { saved: true };
}
async function getOrganizationOnboarding(organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request("saas_onboarding", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0];
}
async function createOrganizationUnit(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request("saas_units", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, name: input.name, slug: input.slug, city: input.city ?? null, status: "active" }) });
  return created;
}
async function archiveOrganizationUnit(organizationId, unitId) {
  if (!isConfigured()) throw new Error("Database not available");
  await request("saas_units", { method: "PATCH", body: JSON.stringify({ status: "archived" }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(unitId)}`);
  return { organizationId, unitId, status: "archived" };
}
async function recordAuditLog(input) {
  if (!isConfigured()) return void 0;
  const [created] = await request("saas_audit_logs", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, auth_user_id: input.userId, action: input.action, entity: input.entity, entity_id: input.entityId ?? null, before_json: input.beforeJson ?? null, after_json: input.afterJson ?? null }) });
  return created;
}
async function getAuditLogs(organizationId, limit = 50, filters) {
  if (!isConfigured()) return [];
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("organization_id", `eq.${organizationId}`);
  params.set("order", "created_at.desc");
  params.set("limit", String(limit));
  if (filters?.from) params.append("created_at", `gte.${filters.from.toISOString()}`);
  if (filters?.to) params.append("created_at", `lte.${filters.to.toISOString()}`);
  if (filters?.userId) params.set("auth_user_id", `eq.${filters.userId}`);
  if (filters?.entity && filters.entity !== "all") params.set("entity", `eq.${filters.entity}`);
  return request("saas_audit_logs", {}, `?${params.toString()}`);
}
function auditLogsToCsv(rows) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["id", "action", "entity", "entityId", "userId", "createdAt"].join(","),
    ...rows.map((row) => [row.id, row.action, row.entity, row.entity_id, row.auth_user_id, row.created_at].map(escape).join(","))
  ].join("\n");
}
function auditLogsToPdfBase64(rows) {
  const sanitize = (value) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const lines = ["ARKE - Auditoria do tenant", "", ...rows.slice(0, 35).map((row) => `${row.created_at} | ${row.action} | ${row.entity} | usu\xE1rio ${row.auth_user_id ?? "-"}`)];
  const content = ["BT", "/F1 9 Tf", "50 800 Td", ...lines.flatMap((line, index) => [index === 0 ? `(${sanitize(line)}) Tj` : "0 -18 Td", index === 0 ? "" : `(${sanitize(line)}) Tj`]), "ET"].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content, "utf8")} >>
stream
${content}
endstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index + 1} 0 obj
${object}
endobj
`;
  });
  const xref = Buffer.byteLength(pdf, "utf8");
  const entries = offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
${entries}
trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}

// server/supabaseAdmin.ts
import { createHash, randomUUID } from "node:crypto";

// server/_core/env.ts
var ENV = {
  isProduction: process.env.NODE_ENV === "production"
};

// server/supabaseAdmin.ts
function config2() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}
async function request2(table, init2 = {}, query = "") {
  const { url, key } = config2();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init2,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init2.headers ?? {} }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
var id = () => randomUUID();
async function authenticateSupabaseAccessToken(accessToken) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Supabase access token inv\xE1lido");
  return response.json();
}
async function updateSupabaseUserPassword(accessToken, password) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/user`, { method: "PUT", headers: { apikey: key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!response.ok) throw new Error("N\xE3o foi poss\xEDvel definir a nova senha. O link pode ter expirado \u2014 solicite a recupera\xE7\xE3o novamente.");
  return response.json();
}
async function findAppUserByEmail(email) {
  const rows = await request2("app_users", {}, `?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows[0] ?? null;
}
async function signInWithSupabase(email, password) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }) });
  if (!response.ok) throw new Error("Usu\xE1rio ou senha inv\xE1lidos.");
  const data = await response.json();
  const appUsers = await request2("app_users", {}, `?select=*&email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user, appUser: appUsers[0] ?? null };
}
async function createSupabaseAuthUser(email, name) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "invite", email: normalizeEmail(email), data: { name } }) });
  if (!response.ok) throw new Error(`Falha ao gerar convite Supabase: ${await response.text()}`);
  return response.json();
}
async function listAppUsers() {
  return request2("app_users", {}, "?select=*&order=created_at.asc");
}
async function createAppUser(input) {
  const authInvite = await createSupabaseAuthUser(input.email, input.name);
  const rows = await request2("app_users", { method: "POST", body: JSON.stringify({ id: id(), ...input }) });
  await sendInviteEmail(input.email, input.name, input.username, authInvite.action_link);
  await notifyAdmins("Novo cadastro no Arke", `<p>O cliente <strong>${input.name}</strong> foi cadastrado no m\xF3dulo ${input.module}.</p><p>Usu\xE1rio: ${input.username}</p>`);
  return rows[0];
}
async function updateAppUser(idValue, input) {
  const rows = await request2("app_users", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro atualizado no Arke", `<p>O cadastro <strong>${input.name ?? idValue}</strong> foi atualizado pela administra\xE7\xE3o.</p>`);
  return rows[0];
}
async function deleteAppUser(idValue) {
  await request2("saas_organizations", { method: "DELETE" }, `?client_id=eq.${encodeURIComponent(idValue)}`);
  await request2("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usu\xE1rio <strong>${idValue}</strong> foi removido pela administra\xE7\xE3o, junto com qualquer organiza\xE7\xE3o vinculada.</p>`);
  return { id: idValue };
}
async function listAppStudents() {
  return request2("app_students", {}, "?select=*&order=created_at.asc");
}
async function createAppStudent(input) {
  const rows = await request2("app_students", { method: "POST", body: JSON.stringify({ id: id(), ...input }) });
  return rows[0];
}
async function updateAppStudent(idValue, input) {
  const rows = await request2("app_students", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteAppStudent(idValue) {
  await request2("app_students", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createPasswordRecoveryCode(email) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: normalizeEmail(email) }) });
  if (!response.ok) return { sent: true };
  const data = await response.json();
  const code = data.email_otp ?? data.token;
  if (code) await sendEmail(normalizeEmail(email), "Recupera\xE7\xE3o de senha \u2014 Arke", `<p>Recebemos uma solicita\xE7\xE3o de recupera\xE7\xE3o de senha.</p><p>Use este c\xF3digo no portal Arke para definir uma nova senha:</p><h2>${code}</h2><p>Este c\xF3digo expira em 1 hora e s\xF3 pode ser usado uma vez. Se voc\xEA n\xE3o fez essa solicita\xE7\xE3o, ignore este e-mail.</p>`);
  return { sent: true };
}
async function verifyPasswordRecoveryCode(email, code) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/verify`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: normalizeEmail(email), token: code }) });
  if (!response.ok) throw new Error("C\xF3digo inv\xE1lido ou expirado. Solicite um novo.");
  return response.json();
}
async function sendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (ENV.isProduction) throw new Error("RESEND_API_KEY n\xE3o configurada \u2014 n\xE3o \xE9 poss\xEDvel enviar e-mail em produ\xE7\xE3o.");
    return { simulated: true };
  }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL ?? "Arke <onboarding@resend.dev>", to: [to], subject, html }) });
  if (!response.ok) throw new Error(`Falha no envio de e-mail: ${await response.text()}`);
  return { simulated: false };
}
async function sendInviteEmail(to, name, username, actionLink) {
  return sendEmail(to, "Convite para acessar o Arke", `<p>Ol\xE1, ${name}.</p><p>Seu acesso ao Arke foi criado.</p><p>Usu\xE1rio: <strong>${username}</strong></p>${actionLink ? `<p><a href="${actionLink}">Aceitar convite e definir senha</a></p>` : ""}`);
}
async function notifyAdmins(subject, html) {
  const recipients = ["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"];
  await Promise.allSettled(recipients.map((email) => sendEmail(email, subject, `<p>Ol\xE1, equipe Arke.</p>${html}<p>Mensagem autom\xE1tica do painel administrativo.</p>`)));
}
function hasSupabaseConfig() {
  return Boolean((process.env.SUPABASE_URL ?? "") && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? ""));
}
var normalizeEmail = (value) => value.trim().toLowerCase();
var ENV_REFERENCE = ENV.isProduction;
async function listGlobalLibrary() {
  const [exercises, groups, templates, templateExercises, nutritionPlans, routines, accessRules] = await Promise.all([
    request2("exercicios", {}, "?select=*&order=created_at.desc"),
    request2("grupos_musculares", {}, "?select=*&order=ordem.asc,nome.asc"),
    request2("treino_templates", {}, "?select=*&order=created_at.desc"),
    request2("treino_template_exercicios", {}, "?select=*&order=divisao.asc,ordem.asc"),
    request2("acervo_planos_alimentares", {}, "?select=*&order=created_at.desc"),
    request2("acervo_rotinas", {}, "?select=*&order=created_at.desc"),
    request2("acervo_acesso_regras", {}, "?select=*&order=modulo.asc,plano.asc")
  ]);
  return { exercises, groups, templates, templateExercises, nutritionPlans, routines, accessRules };
}
async function createGlobalExercise(input) {
  const rows = await request2("exercicios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalExercise(idValue, input) {
  const rows = await request2("exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalExercise(idValue) {
  await request2("exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalGroup(input) {
  const rows = await request2("grupos_musculares", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalGroup(idValue, input) {
  const rows = await request2("grupos_musculares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalGroup(idValue) {
  await request2("grupos_musculares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalTemplate(input) {
  const rows = await request2("treino_templates", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalTemplate(idValue, input) {
  const rows = await request2("treino_templates", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalTemplate(idValue) {
  await request2("treino_templates", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalTemplateExercise(input) {
  const rows = await request2("treino_template_exercicios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalTemplateExercise(idValue, input) {
  const rows = await request2("treino_template_exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalTemplateExercise(idValue) {
  await request2("treino_template_exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalNutritionPlan(input) {
  const rows = await request2("acervo_planos_alimentares", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalNutritionPlan(idValue, input) {
  const rows = await request2("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalNutritionPlan(idValue) {
  await request2("acervo_planos_alimentares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
var inFilter = (ids) => `id=in.(${ids.map(encodeURIComponent).join(",")})`;
async function publishGlobalExercises(ids, userId) {
  if (!ids.length) return [];
  return request2("exercicios", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function publishGlobalTemplates(ids, userId) {
  if (!ids.length) return [];
  return request2("treino_templates", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function publishGlobalNutritionPlans(ids, userId) {
  if (!ids.length) return [];
  return request2("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function createGlobalRoutine(input) {
  const rows = await request2("acervo_rotinas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalRoutine(idValue, input) {
  const rows = await request2("acervo_rotinas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalRoutine(idValue) {
  await request2("acervo_rotinas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function upsertGlobalAccessRule(input) {
  const rows = await request2("acervo_acesso_regras", { method: "POST", body: JSON.stringify(input), headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  return rows[0];
}
async function deleteGlobalAccessRule(idValue) {
  await request2("acervo_acesso_regras", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function getProfileByUserId(userId) {
  const rows = await request2("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function listStudentsInOrganization(organizationId) {
  return request2("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&organization_id=eq.${encodeURIComponent(organizationId)}&order=full_name.asc`);
}
async function updateStudentMatricula(alunoId, input) {
  const body = {};
  if (input.unitId !== void 0) body.unit_id = input.unitId;
  if (input.matriculaEm !== void 0) body.matricula_em = input.matriculaEm;
  const rows = await request2("profiles", { method: "PATCH", body: JSON.stringify(body) }, `?user_id=eq.${encodeURIComponent(alunoId)}`);
  return rows[0];
}
async function getArkeModule(organizationId) {
  const rows = await request2("saas_arke_module", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertArkeModule(input) {
  const body = { organization_id: input.organizationId, enabled: input.enabled, package_tier: input.packageTier ?? null, amount_cents: input.amountCents ?? null, enabled_at: input.enabled ? (/* @__PURE__ */ new Date()).toISOString() : null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("saas_arke_module", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id");
  return rows[0];
}
async function listArkeModulesEnabled() {
  return request2("saas_arke_module", {}, "?select=*&enabled=eq.true");
}
async function markArkeRepasseCharged(organizationId, chargedOn) {
  await request2("saas_arke_module", { method: "PATCH", body: JSON.stringify({ last_repasse_charged_at: chargedOn }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}`);
}
async function getAlunoArkeLicenca(userId, organizationId) {
  const rows = await request2("aluno_arke_licenca", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0] ?? null;
}
async function countAlunosComArkeAtivo(organizationId) {
  const rows = await request2("aluno_arke_licenca", { headers: { Prefer: "count=exact" } }, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&ativo=eq.true`);
  return rows.length;
}
async function toggleAlunoArkeLicenca(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const body = { organization_id: input.organizationId, user_id: input.userId, ativo: input.ativo, ativado_em: input.ativo ? now : void 0, desativado_em: input.ativo ? void 0 : now, ativado_por: input.ativadoPor, updated_at: now };
  const rows = await request2("aluno_arke_licenca", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id,user_id");
  return rows[0];
}
async function listAlunosComArkeAtivoIds(organizationId) {
  const rows = await request2("aluno_arke_licenca", {}, `?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&ativo=eq.true`);
  return rows.map((row) => row.user_id);
}
async function getCheckinDoDia(userId, data) {
  const rows = await request2("checkin_diario", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&data=eq.${encodeURIComponent(data)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertCheckinDiario(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, data: input.data, dedicacao: input.dedicacao };
  const rows = await request2("checkin_diario", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,data");
  return rows[0];
}
async function hasCheckinDesde(userId, desde) {
  const rows = await request2("checkin_diario", {}, `?select=data&user_id=eq.${encodeURIComponent(userId)}&data=gte.${encodeURIComponent(desde)}&limit=1`);
  return rows.length > 0;
}
async function getAvaliacaoSemanal(userId, semana) {
  const rows = await request2("avaliacao_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&semana=eq.${encodeURIComponent(semana)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertAvaliacaoSemanal(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, semana: input.semana, sono: input.sono, produtividade: input.produtividade, humor: input.humor, conquista: input.conquista ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("avaliacao_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,semana");
  return rows[0];
}
async function getPlanoTreinoSemanal(userId) {
  const rows = await request2("plano_treino_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertPlanoTreinoSemanal(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, dias_treino: input.diasTreino, horario_preferido: input.horarioPreferido ?? null, local_treino: input.localTreino ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("plano_treino_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id");
  return rows[0];
}
var PROGRESSO_SEMANAL_SELECT = "id,aluno_id,organization_id,data,peso_kg,gordura_percentual,musculo_percentual,cintura_cm,quadril_cm,braco_cm,perna_cm,bem_estar,observacoes,meta_peso_kg,created_at";
async function listProgressoSemanal(alunoId) {
  return request2("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&aluno_id=eq.${encodeURIComponent(alunoId)}&order=data.asc`);
}
async function hasProgressoSemanalDesde(alunoId, desde) {
  const rows = await request2("progresso_semanal", {}, `?select=id&aluno_id=eq.${encodeURIComponent(alunoId)}&data=gte.${encodeURIComponent(desde)}&limit=1`);
  return rows.length > 0;
}
async function getProgressoSemanal(idValue) {
  const rows = await request2("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createProgressoSemanal(input) {
  const rows = await request2("progresso_semanal", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteProgressoSemanal(idValue) {
  await request2("progresso_semanal", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
var idsInFilter = (column, ids) => `${column}=in.(${ids.map(encodeURIComponent).join(",")})`;
async function listFeedPosts(organizationId, limit = 50) {
  return request2("feed_posts", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=${limit}`);
}
async function getFeedPost(idValue) {
  const rows = await request2("feed_posts", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedPost(input) {
  const rows = await request2("feed_posts", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteFeedPost(idValue) {
  await request2("feed_posts", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listFeedLikesForPosts(postIds) {
  if (!postIds.length) return [];
  return request2("feed_likes", {}, `?select=*&${idsInFilter("post_id", postIds)}`);
}
async function getFeedLike(postId, userId) {
  const rows = await request2("feed_likes", {}, `?select=*&post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedLike(input) {
  const rows = await request2("feed_likes", { method: "POST", body: JSON.stringify({ post_id: input.postId, user_id: input.userId, organization_id: input.organizationId }) });
  return rows[0];
}
async function deleteFeedLike(postId, userId) {
  await request2("feed_likes", { method: "DELETE" }, `?post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}`);
  return { postId, userId };
}
async function listFeedCommentsForPosts(postIds) {
  if (!postIds.length) return [];
  return request2("feed_comments", {}, `?select=*&${idsInFilter("post_id", postIds)}&order=created_at.asc`);
}
async function getFeedComment(idValue) {
  const rows = await request2("feed_comments", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedComment(input) {
  const rows = await request2("feed_comments", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteFeedComment(idValue) {
  await request2("feed_comments", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listProfileNames(userIds) {
  if (!userIds.length) return [];
  return request2("profiles", {}, `?select=user_id,full_name&${idsInFilter("user_id", userIds)}`);
}
async function listMensagensTreino(alunoId) {
  return request2("mensagens_treino", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.asc`);
}
async function createMensagemTreino(input) {
  const rows = await request2("mensagens_treino", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function markMensagensTreinoLidas(alunoId, remetenteTipo) {
  await request2("mensagens_treino", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?aluno_id=eq.${encodeURIComponent(alunoId)}&remetente_tipo=eq.${remetenteTipo}&lida=eq.false`);
}
async function listMensagensDieta(dietaId) {
  return request2("mensagens_dieta", {}, `?select=*&dieta_id=eq.${encodeURIComponent(dietaId)}&order=created_at.asc`);
}
async function createMensagemDieta(input) {
  const rows = await request2("mensagens_dieta", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function markMensagensDietaLidas(dietaId, remetenteTipo) {
  await request2("mensagens_dieta", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?dieta_id=eq.${encodeURIComponent(dietaId)}&remetente_tipo=eq.${remetenteTipo}&lida=eq.false`);
}
async function getPushSubscriptionsForUser(userId) {
  return request2("push_subscriptions", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}`);
}
async function upsertPushSubscription(input) {
  const body = { user_id: input.userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
  const rows = await request2("push_subscriptions", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,endpoint");
  return rows[0];
}
async function deletePushSubscription(userId, endpoint) {
  await request2("push_subscriptions", { method: "DELETE" }, `?user_id=eq.${encodeURIComponent(userId)}&endpoint=eq.${encodeURIComponent(endpoint)}`);
}
async function listNotificacoes(userId, limit = 30) {
  return request2("notificacoes", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`);
}
async function countNotificacoesNaoLidas(userId) {
  const rows = await request2("notificacoes", {}, `?select=id&user_id=eq.${encodeURIComponent(userId)}&lida=eq.false`);
  return rows.length;
}
async function createNotificacao(input) {
  const rows = await request2("notificacoes", { method: "POST", body: JSON.stringify({ user_id: input.userId, titulo: input.titulo, mensagem: input.mensagem ?? null, tipo: input.tipo ?? "info" }) });
  return rows[0];
}
async function markNotificacaoLida(id2, userId) {
  await request2("notificacoes", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?id=eq.${encodeURIComponent(id2)}&user_id=eq.${encodeURIComponent(userId)}`);
}
async function markAllNotificacoesLidas(userId) {
  await request2("notificacoes", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?user_id=eq.${encodeURIComponent(userId)}&lida=eq.false`);
}
async function listProntuarioObservacoes(alunoId) {
  return request2("prontuario_observacoes", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=ano.desc,mes.desc`);
}
async function upsertProntuarioObservacao(input) {
  const body = { aluno_id: input.alunoId, organization_id: input.organizationId, mes: input.mes, ano: input.ano, observacao: input.observacao, criado_por: input.criadoPor, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("prontuario_observacoes", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=aluno_id,mes,ano");
  return rows[0];
}
async function listDesafios(organizationId) {
  return request2("desafios", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=data_fim.desc`);
}
async function getDesafio(idValue) {
  const rows = await request2("desafios", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createDesafio(input) {
  const rows = await request2("desafios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateDesafio(idValue, input) {
  const rows = await request2("desafios", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteDesafio(idValue) {
  await request2("desafios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listDesafioParticipantes(desafioId) {
  return request2("desafio_participantes", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`);
}
async function listDesafioParticipantesForAluno(alunoId) {
  return request2("desafio_participantes", {}, `?select=desafio_id&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function addDesafioParticipante(input) {
  const rows = await request2("desafio_participantes", { method: "POST", body: JSON.stringify({ desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}
async function removeDesafioParticipante(desafioId, alunoId) {
  await request2("desafio_participantes", { method: "DELETE" }, `?desafio_id=eq.${encodeURIComponent(desafioId)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  return { desafioId, alunoId };
}
async function listDesafioProgressoForDesafio(desafioId) {
  return request2("desafio_progresso", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`);
}
async function listDesafioProgressoForAluno(alunoId) {
  return request2("desafio_progresso", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function setDesafioProgresso(input) {
  const body = { desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId, concluido: input.concluido, valor_atual: input.valorAtual ?? null, concluido_por: input.concluido ? input.concluidoPor : null, concluido_em: input.concluido ? (/* @__PURE__ */ new Date()).toISOString() : null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("desafio_progresso", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}
async function listCompeticoes(organizationId) {
  return request2("competicoes", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=data_inicio.desc`);
}
async function getCompeticao(idValue) {
  const rows = await request2("competicoes", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createCompeticao(input) {
  const rows = await request2("competicoes", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateCompeticao(idValue, input) {
  const rows = await request2("competicoes", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteCompeticao(idValue) {
  await request2("competicoes", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listCompeticaoParticipantes(competicaoId) {
  return request2("competicao_participantes", {}, `?select=*&competicao_id=eq.${encodeURIComponent(competicaoId)}`);
}
async function listCompeticaoParticipantesForAluno(alunoId) {
  return request2("competicao_participantes", {}, `?select=competicao_id&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function addCompeticaoParticipante(input) {
  const rows = await request2("competicao_participantes", { method: "POST", body: JSON.stringify({ competicao_id: input.competicaoId, aluno_id: input.alunoId, organization_id: input.organizationId }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=competicao_id,aluno_id");
  return rows[0];
}
async function removeCompeticaoParticipante(competicaoId, alunoId) {
  await request2("competicao_participantes", { method: "DELETE" }, `?competicao_id=eq.${encodeURIComponent(competicaoId)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  return { competicaoId, alunoId };
}
async function listCompeticaoPontuacaoForCompeticao(competicaoId) {
  return request2("competicao_pontuacao", {}, `?select=*&competicao_id=eq.${encodeURIComponent(competicaoId)}`);
}
async function setCompeticaoPontuacao(input) {
  const body = { competicao_id: input.competicaoId, aluno_id: input.alunoId, organization_id: input.organizationId, valor: input.valor, atualizado_por: input.atualizadoPor, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request2("competicao_pontuacao", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=competicao_id,aluno_id");
  return rows[0];
}
async function listExercisesCatalog() {
  return request2("exercicios", {}, "?select=id,nome,grupo_muscular,video_url&estado_publicacao=eq.publicado&order=nome.asc");
}
async function listTreinosForAluno(alunoId, publishedOnly = false) {
  return request2("treinos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`);
}
async function getTreino(idValue) {
  const rows = await request2("treinos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createTreino(input) {
  const rows = await request2("treinos", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateTreino(idValue, input) {
  const rows = await request2("treinos", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteTreino(idValue) {
  await request2("treinos", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listTreinoExercicios(treinoId) {
  return request2("treino_exercicios", {}, `?select=*&treino_id=eq.${encodeURIComponent(treinoId)}&order=ordem.asc`);
}
async function replaceTreinoExercicios(treinoId, items) {
  await request2("treino_exercicios", { method: "DELETE" }, `?treino_id=eq.${encodeURIComponent(treinoId)}`);
  if (!items.length) return [];
  return request2("treino_exercicios", { method: "POST", body: JSON.stringify(items.map((item, index) => ({ ...item, treino_id: treinoId, ordem: index }))) });
}
async function publishTreino(treinoId, autorId) {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino n\xE3o encontrado.");
  const exercicios = await listTreinoExercicios(treinoId);
  const versao = treino.estado_publicacao === "rascunho" ? treino.versao : treino.versao + 1;
  const publicado_em = (/* @__PURE__ */ new Date()).toISOString();
  const atualizado = await updateTreino(treinoId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request2("treino_revisoes", { method: "POST", body: JSON.stringify({ treino_id: treinoId, versao, conteudo: { treino, exercicios }, autor_id: autorId, organization_id: treino.organization_id }) });
  return atualizado;
}
async function listDietasForAluno(alunoId, publishedOnly = false) {
  return request2("dietas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`);
}
async function getDieta(idValue) {
  const rows = await request2("dietas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createDieta(input) {
  const rows = await request2("dietas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateDieta(idValue, input) {
  const rows = await request2("dietas", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteDieta(idValue) {
  await request2("dietas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function publishDieta(dietaId, autorId) {
  const dieta = await getDieta(dietaId);
  if (!dieta) throw new Error("Plano alimentar n\xE3o encontrado.");
  const versao = dieta.estado_publicacao === "rascunho" ? dieta.versao : dieta.versao + 1;
  const publicado_em = (/* @__PURE__ */ new Date()).toISOString();
  const atualizado = await updateDieta(dietaId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request2("dieta_revisoes", { method: "POST", body: JSON.stringify({ dieta_id: dietaId, versao, conteudo: dieta, autor_id: autorId, organization_id: dieta.organization_id }) });
  return atualizado;
}
async function getOrganizationName(organizationId) {
  const rows = await request2("saas_organizations", {}, `?select=id,name&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0]?.name ?? "sua academia";
}
async function findPendingMemberInvitation(organizationId, email) {
  const rows = await request2("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&email=eq.${encodeURIComponent(normalizeEmail(email))}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}
async function listPendingMemberInvitations(organizationId) {
  return request2("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}
async function inviteMember(input) {
  const email = normalizeEmail(input.email);
  const existing = await findPendingMemberInvitation(input.organizationId, email);
  if (existing) throw new Error("J\xE1 existe um convite pendente para este e-mail nesta organiza\xE7\xE3o.");
  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 7);
  const rows = await request2("member_invitations", { method: "POST", body: JSON.stringify({
    organization_id: input.organizationId,
    invited_by_user_id: input.invitedByUserId,
    email,
    full_name: input.fullName,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString()
  }) });
  const invitation = rows[0];
  const orgName = await getOrganizationName(input.organizationId);
  await sendEmail(email, `Convite para o Arke \u2014 ${orgName}`, `<p>Ol\xE1, ${input.fullName}.</p><p>Voc\xEA foi convidado(a) a fazer parte de <strong>${orgName}</strong> no Arke.</p><p>Para concluir seu cadastro, acesse o portal, clique em "Tenho um convite" na tela de login e use o c\xF3digo abaixo:</p><h2 style="letter-spacing:1px">${rawToken}</h2><p>Este convite expira em 7 dias.</p>`);
  return invitation;
}
async function revokeMemberInvitation(id2, organizationId) {
  const rows = await request2("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite n\xE3o encontrado ou j\xE1 utilizado.");
  return rows[0];
}
async function findMemberInvitationByToken(token) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await request2("member_invitations", {}, `?select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}
async function createSupabaseUserWithPassword(email, password, fullName) {
  const { url, key } = config2();
  const response = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password, email_confirm: true, user_metadata: { full_name: fullName } }) });
  if (!response.ok) throw new Error("N\xE3o foi poss\xEDvel criar sua conta. Verifique se este e-mail j\xE1 n\xE3o est\xE1 cadastrado.");
  return response.json();
}
async function acceptMemberInvitation(token, password) {
  const invitation = await findMemberInvitationByToken(token);
  if (!invitation) throw new Error("C\xF3digo de convite inv\xE1lido ou j\xE1 utilizado.");
  if (new Date(invitation.expires_at).getTime() < Date.now()) throw new Error("Este convite expirou. Pe\xE7a para reenviarem o convite.");
  const authUser = await createSupabaseUserWithPassword(invitation.email, password, invitation.full_name);
  await request2("profiles", { method: "PATCH", body: JSON.stringify({ full_name: invitation.full_name, organization_id: invitation.organization_id, status: "active", matricula_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?user_id=eq.${encodeURIComponent(authUser.id)}`);
  const accepted = await request2("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, `?id=eq.${encodeURIComponent(invitation.id)}&status=eq.pending`);
  if (!accepted[0]) throw new Error("Este convite j\xE1 foi utilizado.");
  await request2("leads", { method: "PATCH", body: JSON.stringify({ estagio: "matriculado", convertido_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?member_invitation_id=eq.${encodeURIComponent(invitation.id)}&estagio=eq.convite_enviado`);
  const session = await signInWithSupabase(invitation.email, password);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user, organizationId: invitation.organization_id };
}
async function getAcolhimento(alunoId) {
  const rows = await request2("reuniao_acolhimento", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertAcolhimento(alunoId, data) {
  const rows = await request2("reuniao_acolhimento", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...data, aluno_id: alunoId, criado_por: alunoId, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, "?on_conflict=aluno_id");
  return rows[0];
}
var CHECKIN_PRIORIDADE = {
  com_dificuldade: "atencao",
  quero_ajuda: "prioritario"
};
async function createCheckIn(input) {
  const rows = await request2("check_ins", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, status: input.status, observacao: input.observacao || void 0 }) });
  return rows[0];
}
async function listMyCheckIns(alunoId) {
  return request2("check_ins", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}
async function findOpenAtendimento(alunoId, origem) {
  const rows = await request2("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&origem=eq.${origem}&status=in.(aberta,em_andamento)&limit=1`);
  return rows[0] ?? null;
}
async function createAtendimento(input) {
  const rows = await request2("atendimentos", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, aluno_id: input.alunoId, origem: input.origem, origem_check_in_id: input.origemCheckInId || void 0, prioridade: input.prioridade, descricao: input.descricao || void 0, criado_por: input.criadoPor || void 0, prazo: input.prazo || void 0 }) });
  return rows[0];
}
async function submitCheckIn(input) {
  const checkIn = await createCheckIn(input);
  if (input.status !== "indo_bem") {
    const existing = await findOpenAtendimento(input.alunoId, "check_in");
    if (!existing) await createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "check_in", origemCheckInId: checkIn.id, prioridade: CHECKIN_PRIORIDADE[input.status], descricao: input.observacao });
  }
  return checkIn;
}
async function requestHelp(input) {
  const existing = await findOpenAtendimento(input.alunoId, "pedido_direto");
  if (existing) return existing;
  return createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "pedido_direto", prioridade: "prioritario", descricao: input.descricao, criadoPor: input.alunoId });
}
async function listMyAtendimentos(alunoId) {
  return request2("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}
async function listAtendimentosForOrganization(organizationId, status) {
  return request2("atendimentos", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=created_at.asc`);
}
async function getAtendimento(idValue) {
  const rows = await request2("atendimentos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function assignAtendimento(idValue, responsavelId) {
  const rows = await request2("atendimentos", { method: "PATCH", body: JSON.stringify({ responsavel_id: responsavelId, status: "em_andamento" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function resolveAtendimento(idValue, resolvidoPor, resultado) {
  const rows = await request2("atendimentos", { method: "PATCH", body: JSON.stringify({ status: "resolvida", resultado, resolvido_por: resolvidoPor, resolvido_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
var PRIORIDADE_ORDEM = ["rotina", "atencao", "prioritario", "encaminhamento_profissional"];
var MAX_ESCALONAMENTOS = 3;
var PRAZO_APOS_ESCALONAMENTO_MS = 1e3 * 60 * 60 * 24 * 2;
var DIAS_SEM_CHECKIN = 7;
var DIAS_CONVITE_PENDENTE = 3;
async function listAtendimentosVencidos() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return request2("atendimentos", {}, `?select=*&status=in.(aberta,em_andamento)&prazo=lt.${encodeURIComponent(now)}&escalonamentos_count=lt.${MAX_ESCALONAMENTOS}`);
}
async function escalateAtendimento(atendimento) {
  const proximoIndex = Math.min(PRIORIDADE_ORDEM.indexOf(atendimento.prioridade) + 1, PRIORIDADE_ORDEM.length - 1);
  const rows = await request2("atendimentos", { method: "PATCH", body: JSON.stringify({
    prioridade: PRIORIDADE_ORDEM[proximoIndex],
    escalonamentos_count: atendimento.escalonamentos_count + 1,
    prazo: new Date(Date.now() + PRAZO_APOS_ESCALONAMENTO_MS).toISOString()
  }) }, `?id=eq.${encodeURIComponent(atendimento.id)}`);
  return rows[0];
}
async function listAlunosSemCheckIn(dias = DIAS_SEM_CHECKIN) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1e3).toISOString();
  const candidatos = await request2("profiles", {}, `?select=user_id,organization_id,created_at&status=eq.active&organization_id=not.is.null&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.user_id).join(",");
  const recentes = await request2("check_ins", {}, `?select=aluno_id&aluno_id=in.(${ids})&created_at=gte.${encodeURIComponent(cutoff)}`);
  const comCheckInRecente = new Set(recentes.map((r) => r.aluno_id));
  return candidatos.filter((c) => !comCheckInRecente.has(c.user_id));
}
async function createSemCheckInAtendimentoIfNeeded(alunoId, organizationId, dias) {
  try {
    return await createAtendimento({ organizationId, alunoId, origem: "sem_checkin", prioridade: "rotina", descricao: `Sem registro de check-in h\xE1 mais de ${dias} dias.` });
  } catch {
    return null;
  }
}
async function listInvitationsForReminder(dias = DIAS_CONVITE_PENDENTE) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1e3).toISOString();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return request2("member_invitations", {}, `?select=*&status=eq.pending&lembrete_enviado_em=is.null&created_at=lt.${encodeURIComponent(cutoff)}&expires_at=gt.${encodeURIComponent(now)}`);
}
async function resendInvitationReminder(invitation) {
  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 7).toISOString();
  await request2("member_invitations", { method: "PATCH", body: JSON.stringify({ token_hash: tokenHash, expires_at: expiresAt, lembrete_enviado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(invitation.id)}`);
  const orgName = await getOrganizationName(invitation.organization_id);
  await sendEmail(invitation.email, `Lembrete: convite para o Arke \u2014 ${orgName}`, `<p>Ol\xE1, ${invitation.full_name}.</p><p>Voc\xEA ainda n\xE3o concluiu seu cadastro em <strong>${orgName}</strong> no Arke.</p><p>Acesse o portal, clique em "Tenho um convite" na tela de login e use o novo c\xF3digo abaixo:</p><h2 style="letter-spacing:1px">${rawToken}</h2><p>Este convite expira em 7 dias.</p>`);
}
async function runAutomacaoDiaria() {
  const resultado = { tarefasEscaladas: 0, lembretesCheckIn: 0, lembretesConvite: 0, followUpsLeads: 0, erros: [] };
  try {
    for (const atendimento of await listAtendimentosVencidos()) {
      try {
        await escalateAtendimento(atendimento);
        resultado.tarefasEscaladas += 1;
      } catch (error) {
        resultado.erros.push(`escalonamento ${atendimento.id}: ${error.message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar tarefas vencidas: ${error.message}`);
  }
  try {
    for (const perfil of await listAlunosSemCheckIn()) {
      try {
        if (await createSemCheckInAtendimentoIfNeeded(perfil.user_id, perfil.organization_id, DIAS_SEM_CHECKIN)) resultado.lembretesCheckIn += 1;
      } catch (error) {
        resultado.erros.push(`sem-checkin ${perfil.user_id}: ${error.message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar alunos sem check-in: ${error.message}`);
  }
  try {
    for (const invitation of await listInvitationsForReminder()) {
      try {
        await resendInvitationReminder(invitation);
        resultado.lembretesConvite += 1;
      } catch (error) {
        resultado.erros.push(`lembrete convite ${invitation.id}: ${error.message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar convites pendentes: ${error.message}`);
  }
  try {
    for (const lead of await listLeadsSemContato()) {
      try {
        if (await createFollowUpLeadIfNeeded(lead.id, lead.organization_id, DIAS_LEAD_SEM_CONTATO)) resultado.followUpsLeads += 1;
      } catch (error) {
        resultado.erros.push(`follow-up lead ${lead.id}: ${error.message}`);
      }
    }
  } catch (error) {
    resultado.erros.push(`listar leads sem contato: ${error.message}`);
  }
  return resultado;
}
function resumoEntrega(alunoIds, registros) {
  const temRegistro = /* @__PURE__ */ new Set();
  const temPublicado = /* @__PURE__ */ new Set();
  for (const registro of registros) {
    if (!alunoIds.has(registro.aluno_id)) continue;
    temRegistro.add(registro.aluno_id);
    if (registro.estado_publicacao === "publicado") temPublicado.add(registro.aluno_id);
  }
  return { semRegistro: alunoIds.size - temRegistro.size, rascunho: temRegistro.size - temPublicado.size, publicado: temPublicado.size };
}
async function getGestaoIndicadores(organizationId) {
  const trintaDiasAtras = new Date(Date.now() - 1e3 * 60 * 60 * 24 * 30).toISOString();
  const [alunos, staff, treinos, dietas, abertos, resolvidosRecentes] = await Promise.all([
    request2("profiles", {}, `?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request2("saas_memberships", {}, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request2("treinos", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request2("dietas", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request2("atendimentos", {}, `?select=status,prioridade,prazo&organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(aberta,em_andamento)`),
    request2("atendimentos", {}, `?select=created_at,resolvido_em&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.resolvida&resolvido_em=gte.${encodeURIComponent(trintaDiasAtras)}`)
  ]);
  const alunoIds = new Set(alunos.map((a) => a.user_id));
  const now = Date.now();
  const porPrioridade = { rotina: 0, atencao: 0, prioritario: 0, encaminhamento_profissional: 0 };
  for (const item of abertos) porPrioridade[item.prioridade] += 1;
  const temposResolucaoHoras = resolvidosRecentes.filter((item) => item.resolvido_em).map((item) => (new Date(item.resolvido_em).getTime() - new Date(item.created_at).getTime()) / (1e3 * 60 * 60));
  return {
    capacidade: { totalAlunos: alunoIds.size, totalStaff: staff.length, mediaAlunosPorStaff: staff.length ? alunoIds.size / staff.length : null },
    entrega: { treino: resumoEntrega(alunoIds, treinos), dieta: resumoEntrega(alunoIds, dietas) },
    atendimento: {
      abertos: abertos.filter((item) => item.status === "aberta").length,
      emAndamento: abertos.filter((item) => item.status === "em_andamento").length,
      vencidos: abertos.filter((item) => item.prazo && new Date(item.prazo).getTime() < now).length,
      resolvidosUltimos30Dias: resolvidosRecentes.length,
      tempoMedioResolucaoHoras: temposResolucaoHoras.length ? temposResolucaoHoras.reduce((sum, horas) => sum + horas, 0) / temposResolucaoHoras.length : null,
      porPrioridade
    }
  };
}
async function registrarFrequencia(input) {
  const rows = await request2("frequencia_registros", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, unit_id: input.unitId || void 0, origem: input.origem, registrado_por: input.registradoPor || void 0 }) });
  return rows[0];
}
async function listFrequenciaForAluno(alunoId, limit = 30) {
  return request2("frequencia_registros", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=registrado_em.desc&limit=${limit}`);
}
async function listFrequenciaForOrganization(organizationId, limit = 100) {
  return request2("frequencia_registros", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=registrado_em.desc&limit=${limit}`);
}
function sanitizePdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
function buildThermalPdfBase64(lines) {
  const widthPt = 80 * 2.8346;
  const lineHeight = 12;
  const marginTop = 16;
  const heightPt = Math.max(140, marginTop + lineHeight * (lines.length + 1));
  const contentLines = lines.map((line, index) => index === 0 ? `(${sanitizePdfText(line)}) Tj` : `0 -${lineHeight} Td
(${sanitizePdfText(line)}) Tj`);
  const content = ["BT", "/F1 8 Tf", `8 ${(heightPt - marginTop).toFixed(2)} Td`, ...contentLines, "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt.toFixed(2)} ${heightPt.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>
stream
${content}
endstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index + 1} 0 obj
${object}
endobj
`;
  });
  const xref = Buffer.byteLength(pdf, "utf8");
  const entries = offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n");
  pdf += `xref
0 ${objects.length + 1}
0000000000 65535 f 
${entries}
trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}
async function gerarFichaTreinoPdf(treinoId) {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino n\xE3o encontrado.");
  const [exercicios, catalogo, aluno] = await Promise.all([
    listTreinoExercicios(treinoId),
    listExercisesCatalog(),
    getProfileByUserId(treino.aluno_id)
  ]);
  const nomeExercicio = (idValue) => catalogo.find((exercicio) => exercicio.id === idValue)?.nome ?? "Exerc\xEDcio";
  const orgNome = treino.organization_id ? await getOrganizationName(treino.organization_id) : "Arke";
  const lines = [
    orgNome,
    `Ficha: ${treino.titulo} (${treino.tipo})`,
    `Aluno: ${aluno?.full_name ?? "-"}`,
    `Versao ${treino.versao} - ${(/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR")}`,
    "-".repeat(30)
  ];
  if (!exercicios.length) lines.push("Nenhum exercicio cadastrado.");
  exercicios.forEach((exercicio, index) => {
    lines.push(`${index + 1}. ${nomeExercicio(exercicio.exercicio_id)}`);
    lines.push(`   ${exercicio.series}x${exercicio.repeticoes}  descanso ${exercicio.descanso_seg}s`);
    if (exercicio.observacoes) lines.push(`   Obs: ${exercicio.observacoes}`);
  });
  lines.push("-".repeat(30));
  lines.push("Bom treino!");
  return { filename: `ficha-${treino.titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-v${treino.versao}.pdf`, contentBase64: buildThermalPdfBase64(lines) };
}
async function listTurmasForOrganization(organizationId) {
  return request2("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=nome.asc`);
}
async function listTurmasAtivas(organizationId) {
  return request2("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.ativa&order=nome.asc`);
}
async function getTurma(idValue) {
  const rows = await request2("turmas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createTurma(input) {
  const rows = await request2("turmas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateTurma(idValue, input) {
  const rows = await request2("turmas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteTurma(idValue) {
  await request2("turmas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listTurmaHorarios(turmaId) {
  return request2("turma_horarios", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&order=dia_semana.asc,hora_inicio.asc`);
}
async function replaceTurmaHorarios(turmaId, items) {
  await request2("turma_horarios", { method: "DELETE" }, `?turma_id=eq.${encodeURIComponent(turmaId)}`);
  if (!items.length) return [];
  return request2("turma_horarios", { method: "POST", body: JSON.stringify(items.map((item) => ({ ...item, turma_id: turmaId }))) });
}
async function listReservasForTurmaData(turmaId, data) {
  return request2("turma_reservas", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&data=eq.${encodeURIComponent(data)}&status=eq.confirmada`);
}
async function getReserva(idValue) {
  const rows = await request2("turma_reservas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function listMinhasReservas(alunoId) {
  const hoje = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return request2("turma_reservas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&status=eq.confirmada&data=gte.${encodeURIComponent(hoje)}&order=data.asc`);
}
async function getVagasDisponiveis(turmaId, data) {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma n\xE3o encontrada.");
  const reservas = await listReservasForTurmaData(turmaId, data);
  return { limite: turma.limite_vagas, ocupadas: reservas.length, disponiveis: Math.max(0, turma.limite_vagas - reservas.length) };
}
async function reservarVaga(input) {
  const turma = await getTurma(input.turmaId);
  if (!turma || turma.status !== "ativa" || turma.organization_id !== input.organizationId) throw new Error("Turma n\xE3o encontrada ou inativa.");
  const horarios = await listTurmaHorarios(input.turmaId);
  const diaSemana = (/* @__PURE__ */ new Date(`${input.data}T00:00:00Z`)).getUTCDay();
  if (!horarios.some((horario) => horario.dia_semana === diaSemana)) throw new Error("Esta turma n\xE3o tem hor\xE1rio nesse dia da semana.");
  const existentes = await listReservasForTurmaData(input.turmaId, input.data);
  if (existentes.some((reserva) => reserva.aluno_id === input.alunoId)) throw new Error("Voc\xEA j\xE1 reservou vaga nesta sess\xE3o.");
  if (existentes.length >= turma.limite_vagas) throw new Error("N\xE3o h\xE1 vagas dispon\xEDveis para esta sess\xE3o.");
  const rows = await request2("turma_reservas", { method: "POST", body: JSON.stringify({ turma_id: input.turmaId, aluno_id: input.alunoId, organization_id: input.organizationId, data: input.data }) });
  return rows[0];
}
async function cancelarReserva(idValue, alunoId) {
  const rows = await request2("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  if (!rows[0]) throw new Error("Reserva n\xE3o encontrada.");
  return rows[0];
}
async function cancelarReservaStaff(idValue) {
  const rows = await request2("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Reserva n\xE3o encontrada.");
  return rows[0];
}
var DIAS_LEAD_SEM_CONTATO = 3;
async function listLeadsForOrganization(organizationId) {
  return request2("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc`);
}
async function getLead(idValue) {
  const rows = await request2("leads", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createLead(input) {
  const rows = await request2("leads", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId || void 0, nome: input.nome, telefone: input.telefone || void 0, email: input.email || void 0, origem: input.origem || void 0, interesse: input.interesse || void 0, responsavel_id: input.responsavelId || void 0, notas: input.notas || void 0, criado_por: input.criadoPor || void 0 }) });
  return rows[0];
}
async function updateLead(idValue, data) {
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ nome: data.nome, telefone: data.telefone, email: data.email, origem: data.origem, interesse: data.interesse, unit_id: data.unitId, responsavel_id: data.responsavelId, notas: data.notas }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead n\xE3o encontrado.");
  return rows[0];
}
async function deleteLead(idValue) {
  await request2("leads", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { success: true };
}
async function closeOpenFollowUps(leadId) {
  await request2("lead_atividades", { method: "PATCH", body: JSON.stringify({ status: "concluida" }) }, `?lead_id=eq.${encodeURIComponent(leadId)}&tipo=eq.follow_up_automatico&status=eq.aberta`);
}
async function moverEstagioLead(idValue, estagio) {
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ estagio }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead n\xE3o encontrado.");
  await closeOpenFollowUps(idValue);
  return rows[0];
}
async function marcarLeadPerdido(idValue, motivoPerda) {
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ estagio: "perdido", motivo_perda: motivoPerda }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead n\xE3o encontrado.");
  await closeOpenFollowUps(idValue);
  return rows[0];
}
async function converterLead(idValue, invitedByUserId) {
  const lead = await getLead(idValue);
  if (!lead) throw new Error("Lead n\xE3o encontrado.");
  if (lead.estagio === "matriculado") throw new Error("Este lead j\xE1 foi convertido.");
  if (lead.estagio === "convite_enviado") throw new Error("O convite j\xE1 foi enviado a este lead \u2014 aguarde o aceite ou reenvie pelo painel de convites pendentes.");
  if (lead.estagio === "perdido") throw new Error("Este lead est\xE1 marcado como perdido.");
  if (!lead.email) throw new Error("Informe o e-mail do lead antes de converter \u2014 o convite de aluno exige e-mail.");
  const invitation = await inviteMember({ organizationId: lead.organization_id, invitedByUserId, email: lead.email, fullName: lead.nome });
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ estagio: "convite_enviado", member_invitation_id: invitation.id }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  await closeOpenFollowUps(idValue);
  return { lead: rows[0], invitation };
}
async function listLeadAtividades(leadId) {
  return request2("lead_atividades", {}, `?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.desc`);
}
async function createLeadNota(input) {
  const rows = await request2("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: input.leadId, organization_id: input.organizationId, tipo: "nota", status: "concluida", descricao: input.descricao, criado_por: input.criadoPor, responsavel_id: input.responsavelId || void 0 }) });
  await closeOpenFollowUps(input.leadId);
  return rows[0];
}
async function listLeadsSemContato(dias = DIAS_LEAD_SEM_CONTATO) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1e3).toISOString();
  const candidatos = await request2("leads", {}, `?select=id,organization_id,created_at&estagio=not.in.(matriculado,perdido)&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.id).join(",");
  const atividades = await request2("lead_atividades", {}, `?select=lead_id,created_at&lead_id=in.(${ids})&order=created_at.desc`);
  const ultimaAtividade = /* @__PURE__ */ new Map();
  for (const atividade of atividades) if (!ultimaAtividade.has(atividade.lead_id)) ultimaAtividade.set(atividade.lead_id, atividade.created_at);
  return candidatos.filter((lead) => (ultimaAtividade.get(lead.id) ?? lead.created_at) < cutoff);
}
async function createFollowUpLeadIfNeeded(leadId, organizationId, dias) {
  try {
    return await request2("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: leadId, organization_id: organizationId, tipo: "follow_up_automatico", status: "aberta", descricao: `Sem contato registrado h\xE1 mais de ${dias} dias.` }) }).then((rows) => rows[0]);
  } catch {
    return null;
  }
}
var FOLLOW_UP_ATRASADO_HORAS = 48;
async function getCrmIndicadores(organizationId, unitId) {
  const filtroUnidade = unitId ? `&unit_id=eq.${encodeURIComponent(unitId)}` : "";
  const trintaDiasAtras = new Date(Date.now() - 1e3 * 60 * 60 * 24 * 30).toISOString();
  const [leads, atividadesOrg] = await Promise.all([
    request2("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${filtroUnidade}`),
    request2("lead_atividades", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.asc`)
  ]);
  const leadIds = new Set(leads.map((lead) => lead.id));
  const atividades = atividadesOrg.filter((atividade) => leadIds.has(atividade.lead_id));
  const porEstagio = { novo: 0, contato_feito: 0, visita_agendada: 0, convite_enviado: 0, matriculado: 0, perdido: 0 };
  for (const lead of leads) porEstagio[lead.estagio] += 1;
  const totalConsiderado = leads.length - porEstagio.perdido;
  const taxaConversao = totalConsiderado > 0 ? porEstagio.matriculado / totalConsiderado : null;
  const origemMap = /* @__PURE__ */ new Map();
  for (const lead of leads) {
    const chave = lead.origem?.trim() || "N\xE3o informado";
    origemMap.set(chave, (origemMap.get(chave) ?? 0) + 1);
  }
  const porOrigem = Array.from(origemMap.entries()).map(([origem, total]) => ({ origem, total })).sort((a, b) => b.total - a.total);
  const motivoMap = /* @__PURE__ */ new Map();
  for (const lead of leads) {
    if (lead.estagio !== "perdido" || !lead.motivo_perda) continue;
    const chave = lead.motivo_perda.trim();
    motivoMap.set(chave, (motivoMap.get(chave) ?? 0) + 1);
  }
  const motivosPerda = Array.from(motivoMap.entries()).map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total).slice(0, 8);
  const followUpsAbertos = atividades.filter((atividade) => atividade.tipo === "follow_up_automatico" && atividade.status === "aberta");
  const agora = Date.now();
  const followUpsAtrasados = followUpsAbertos.filter((atividade) => (agora - new Date(atividade.created_at).getTime()) / (1e3 * 60 * 60) > FOLLOW_UP_ATRASADO_HORAS);
  const primeiraNotaPorLead = /* @__PURE__ */ new Map();
  for (const atividade of atividades) {
    if (atividade.tipo !== "nota") continue;
    if (!primeiraNotaPorLead.has(atividade.lead_id)) primeiraNotaPorLead.set(atividade.lead_id, atividade.created_at);
  }
  const temposResposta = [];
  for (const lead of leads) {
    const primeiraNota = primeiraNotaPorLead.get(lead.id);
    if (!primeiraNota) continue;
    temposResposta.push((new Date(primeiraNota).getTime() - new Date(lead.created_at).getTime()) / (1e3 * 60 * 60));
  }
  const tempoMedioPrimeiraRespostaHoras = temposResposta.length ? temposResposta.reduce((soma, valor) => soma + valor, 0) / temposResposta.length : null;
  const novosPorDiaMap = /* @__PURE__ */ new Map();
  for (const lead of leads) {
    if (lead.created_at < trintaDiasAtras) continue;
    const dia = lead.created_at.slice(0, 10);
    novosPorDiaMap.set(dia, (novosPorDiaMap.get(dia) ?? 0) + 1);
  }
  const novosPorDia = Array.from(novosPorDiaMap.entries()).map(([data, total]) => ({ data, total })).sort((a, b) => a.data.localeCompare(b.data));
  return { porEstagio, taxaConversao, porOrigem, motivosPerda, followUps: { abertos: followUpsAbertos.length, atrasados: followUpsAtrasados.length }, tempoMedioPrimeiraRespostaHoras, novosPorDia };
}
async function rpc2(fn, args) {
  const { url, key } = config2();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function getCurrentPrivacyPolicy() {
  const rows = await request2("privacy_policy_versions", {}, "?select=*&order=effective_at.desc&limit=1");
  return rows[0] ?? null;
}
async function hasConsent(userId, consentType) {
  const rows = await request2("user_consents", {}, `?select=id&user_id=eq.${encodeURIComponent(userId)}&consent_type=eq.${consentType}&granted=eq.true&limit=1`);
  return rows.length > 0;
}
async function recordConsent(input) {
  const rows = await request2("user_consents", { method: "POST", body: JSON.stringify({ user_id: input.userId, consent_type: input.consentType, policy_version_id: input.policyVersionId ?? null, granted: true, ip_address: input.ipAddress ?? null, user_agent: input.userAgent ?? null }) });
  return rows[0];
}
async function createDeletionRequest(input) {
  const existing = await request2("data_deletion_requests", {}, `?select=id&user_id=eq.${encodeURIComponent(input.userId)}&status=eq.pending&limit=1`);
  if (existing.length) throw new Error("Voc\xEA j\xE1 tem uma solicita\xE7\xE3o de exclus\xE3o pendente.");
  const rows = await request2("data_deletion_requests", { method: "POST", body: JSON.stringify({ user_id: input.userId, organization_id: input.organizationId, reason: input.reason || void 0 }) });
  return rows[0];
}
async function getMyDeletionRequest(userId) {
  const rows = await request2("data_deletion_requests", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=requested_at.desc&limit=1`);
  return rows[0] ?? null;
}
async function getDeletionRequest(idValue) {
  const rows = await request2("data_deletion_requests", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function listDeletionRequests(organizationId, status) {
  return request2("data_deletion_requests", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=requested_at.asc`);
}
async function fulfillDeletionRequest(input) {
  await rpc2("delete_member_data", { p_aluno_id: input.alunoId, p_resolved_by: input.resolvedBy, p_request_id: input.requestId, p_note: input.note || null });
  return { requestId: input.requestId, status: "completed" };
}
async function rejectDeletionRequest(input) {
  const rows = await request2("data_deletion_requests", { method: "PATCH", body: JSON.stringify({ status: "rejected", resolved_at: (/* @__PURE__ */ new Date()).toISOString(), resolved_by: input.resolvedBy, resolution_note: input.note || null }) }, `?id=eq.${encodeURIComponent(input.requestId)}&organization_id=eq.${encodeURIComponent(input.organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Solicita\xE7\xE3o n\xE3o encontrada ou j\xE1 resolvida.");
  return rows[0];
}

// server/arkeEntitlement.ts
async function alunoTemArke(userId) {
  const profile = await getProfileByUserId(userId);
  if (!profile?.organization_id) return false;
  const licenca = await getAlunoArkeLicenca(userId, profile.organization_id);
  return licenca?.ativo ?? false;
}
async function assertAlunoTemArke(userId) {
  if (!await alunoTemArke(userId)) throw new Error("Este conte\xFAdo faz parte do m\xE9todo Arke, que ainda n\xE3o est\xE1 ativo para voc\xEA. Fale com seu profissional.");
}

// server/cnpj.ts
async function lookupCnpj(cnpj) {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) throw new Error("Informe um CNPJ v\xE1lido com 14 d\xEDgitos.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8e3);
  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("CNPJ n\xE3o encontrado ou servi\xE7o temporariamente indispon\xEDvel.");
    const data = await response.json();
    return { ...data, cnpj: digits };
  } catch (error) {
    if (error instanceof Error && error.message.includes("CNPJ")) throw error;
    throw new Error("N\xE3o foi poss\xEDvel consultar o CNPJ agora. Voc\xEA pode preencher os dados manualmente.");
  } finally {
    clearTimeout(timeout);
  }
}

// server/integrations.ts
function config3() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado.");
  return { url: url.replace(/\/$/, ""), key };
}
async function request3(table, init2 = {}, query = "") {
  const { url, key } = config3();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, { ...init2, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init2.headers ?? {} } });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}
var BENEFIT_SECRET_FIELD = { wellhub: "client_secret", totalpass: "app_secret" };
var BENEFIT_PUBLIC_FIELDS = { wellhub: ["client_id", "partner_id"], totalpass: ["app_key", "gym_id"] };
async function getRawBenefitIntegration(organizationId, provider) {
  const rows = await request3("saas_benefit_integrations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&provider=eq.${provider}&limit=1`);
  return rows[0] ?? null;
}
async function getBenefitIntegration(organizationId, provider) {
  const row = await getRawBenefitIntegration(organizationId, provider);
  const credentials = row?.credentials ?? {};
  const publicFields = Object.fromEntries(BENEFIT_PUBLIC_FIELDS[provider].map((field) => [field, credentials[field] ?? ""]));
  return { provider, enabled: row?.enabled ?? false, configured: Boolean(credentials[BENEFIT_SECRET_FIELD[provider]]), publicFields, updatedAt: row?.updated_at ?? null };
}
async function listBenefitIntegrations(organizationId) {
  const [wellhub, totalpass] = await Promise.all([getBenefitIntegration(organizationId, "wellhub"), getBenefitIntegration(organizationId, "totalpass")]);
  return [wellhub, totalpass];
}
async function saveBenefitIntegration(input) {
  const existing = await getRawBenefitIntegration(input.organizationId, input.provider);
  const secretField = BENEFIT_SECRET_FIELD[input.provider];
  const merged = { ...existing?.credentials ?? {}, ...input.fields };
  if (!input.fields[secretField]) merged[secretField] = existing?.credentials?.[secretField] ?? "";
  await request3("saas_benefit_integrations", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, provider: input.provider, enabled: input.enabled, credentials: merged }) }, "?on_conflict=organization_id,provider");
  return getBenefitIntegration(input.organizationId, input.provider);
}
async function listTurnstileIntegrationsForOrganization(organizationId) {
  const rows = await request3("saas_turnstile_integrations", {}, `?select=*,saas_units(name)&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return rows.map((row) => ({ unitId: row.unit_id, unitName: row.saas_units?.name ?? "Unidade", brand: row.brand, model: row.model, enabled: row.enabled, configured: Object.keys(row.config ?? {}).length > 0, updatedAt: row.updated_at }));
}
async function saveTurnstileIntegration(input) {
  await request3("saas_turnstile_integrations", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ unit_id: input.unitId, organization_id: input.organizationId, brand: input.brand, model: input.model || null, config: input.config, enabled: input.enabled }) }, "?on_conflict=unit_id");
  const rows = await listTurnstileIntegrationsForOrganization(input.organizationId);
  return rows.find((row) => row.unitId === input.unitId);
}
async function deleteTurnstileIntegration(unitId, organizationId) {
  await request3("saas_turnstile_integrations", { method: "DELETE" }, `?unit_id=eq.${encodeURIComponent(unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return { success: true };
}

// server/_core/llm.ts
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") return { type: "text", text: part };
  return part;
};
var normalizeMessage = (message) => {
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role: message.role, name: message.name, content: contentParts[0].text };
  }
  return { role: message.role, name: message.name, content: contentParts };
};
var normalizeResponseFormat = ({ responseFormat, outputSchema }) => {
  if (responseFormat) return responseFormat;
  if (!outputSchema) return void 0;
  if (!outputSchema.name || !outputSchema.schema) throw new Error("outputSchema requires both name and schema");
  return { type: "json_schema", json_schema: { name: outputSchema.name, schema: outputSchema.schema, strict: outputSchema.strict ?? true } };
};
var DEFAULT_MODEL = "gpt-4o-mini";
var RETRY_MAX_RETRIES = 3;
var RETRY_BASE_DELAY_MS = 500;
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}
function assertApiKey() {
  if (!openaiConfigured()) throw new Error("OPENAI_API_KEY n\xE3o configurada.");
}
async function fetchWithBackoff(url, init2) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init2);
      if (response.ok || attempt === RETRY_MAX_RETRIES) return response;
      try {
        await response.body?.cancel();
      } catch {
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha ao chamar a OpenAI ap\xF3s esgotar as tentativas.");
}
async function invokeLLM(params) {
  assertApiKey();
  const payload = {
    model: params.model ?? DEFAULT_MODEL,
    messages: params.messages.map(normalizeMessage)
  };
  const responseFormat = normalizeResponseFormat(params);
  if (responseFormat) payload.response_format = responseFormat;
  if (typeof params.maxTokens === "number") payload.max_tokens = params.maxTokens;
  const response = await fetchWithBackoff("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`OpenAI invoke failed: ${response.status} ${response.statusText} \u2013 ${await response.text()}`);
  return await response.json();
}

// server/acervoAi.ts
var MODEL = "gpt-4o-mini";
async function sugerirExercicio(input) {
  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Voc\xEA \xE9 um assistente de curadoria de exerc\xEDcios de muscula\xE7\xE3o/treino f\xEDsico para uma plataforma de academias no Brasil. Responda em portugu\xEAs do Brasil, com linguagem curta, segura e profissional. Nunca invente contraindica\xE7\xE3o m\xE9dica espec\xEDfica \u2014 oriente apenas boa execu\xE7\xE3o geral." },
      { role: "user", content: `Exerc\xEDcio: ${input.nome}
Grupo muscular: ${input.grupoMuscular}
Equipamento informado pelo cadastrador: ${input.equipamento || "n\xE3o informado"}

Sugira uma descri\xE7\xE3o curta (1-2 frases), instru\xE7\xF5es de execu\xE7\xE3o (passo a passo, at\xE9 5 passos, separados por quebra de linha) e o equipamento necess\xE1rio (se n\xE3o informado, sugira o mais prov\xE1vel).` }
    ],
    outputSchema: {
      name: "sugestao_exercicio",
      schema: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          instrucoes: { type: "string" },
          equipamento: { type: "string" }
        },
        required: ["descricao", "instrucoes", "equipamento"],
        additionalProperties: false
      },
      strict: true
    }
  });
  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA n\xE3o retornou sugest\xE3o.");
  return JSON.parse(content);
}
async function sugerirModeloTreino(input) {
  const { exercises } = await listGlobalLibrary();
  if (!exercises.length) throw new Error("Cadastre exerc\xEDcios no acervo antes de gerar um modelo com IA.");
  const catalogo = exercises.map((ex) => `${ex.id}::${ex.nome} (${ex.grupo_muscular})`).join("\n");
  const result = await invokeLLM({
    model: MODEL,
    messages: [
      { role: "system", content: "Voc\xEA \xE9 um assistente de curadoria de modelos de treino (fichas) para uma plataforma de academias no Brasil. Monte a ficha usando SOMENTE exerc\xEDcios da lista fornecida, referenciando pelo id exato. Nunca invente um exerc\xEDcio que n\xE3o est\xE1 na lista \u2014 se a lista n\xE3o cobrir bem alguma divis\xE3o, use os exerc\xEDcios mais pr\xF3ximos dispon\xEDveis. Responda em portugu\xEAs do Brasil." },
      { role: "user", content: `Objetivo do modelo: ${input.objetivo}
Categoria: ${input.categoria}
Divis\xF5es desejadas: ${input.divisoes.join(", ")}

Exerc\xEDcios dispon\xEDveis no acervo (id::nome (grupo muscular)):
${catalogo}

Monte, para cada divis\xE3o, de 2 a 6 exerc\xEDcios com id do exerc\xEDcio (copiado exatamente da lista), s\xE9ries, repeti\xE7\xF5es (ex.: "12" ou "8-12") e descanso em segundos. Inclua tamb\xE9m uma descri\xE7\xE3o curta do modelo.` }
    ],
    outputSchema: {
      name: "sugestao_modelo_treino",
      schema: {
        type: "object",
        properties: {
          descricao: { type: "string" },
          divisoes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                divisao: { type: "string" },
                exercicios: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      exercicio_id: { type: "string" },
                      series: { type: "integer" },
                      repeticoes: { type: "string" },
                      descanso_seg: { type: "integer" }
                    },
                    required: ["exercicio_id", "series", "repeticoes", "descanso_seg"],
                    additionalProperties: false
                  }
                }
              },
              required: ["divisao", "exercicios"],
              additionalProperties: false
            }
          }
        },
        required: ["descricao", "divisoes"],
        additionalProperties: false
      },
      strict: true
    }
  });
  const content = result.choices[0]?.message.content;
  if (!content) throw new Error("A IA n\xE3o retornou sugest\xE3o.");
  const parsed = JSON.parse(content);
  const validIds = new Set(exercises.map((ex) => ex.id));
  const divisoesValidadas = parsed.divisoes.map((divisao) => ({ divisao: divisao.divisao, exercicios: divisao.exercicios.filter((ex) => validIds.has(ex.exercicio_id)) })).filter((divisao) => divisao.exercicios.length > 0);
  if (!divisoesValidadas.length) throw new Error("A IA n\xE3o conseguiu montar um modelo v\xE1lido com os exerc\xEDcios j\xE1 cadastrados.");
  return { titulo: `${input.categoria} \u2014 ${input.objetivo}`.slice(0, 160), categoria: input.categoria, descricao: parsed.descricao, divisoes: divisoesValidadas };
}

// server/push.ts
import webpush from "web-push";
var VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
var VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
var VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@arkefit.com.br";
function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}
function getVapidPublicKey() {
  return pushConfigured() ? VAPID_PUBLIC_KEY : null;
}
if (pushConfigured()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}
async function sendPushToUser(userId, payload) {
  if (!pushConfigured()) return { sent: 0 };
  const subscriptions = await getPushSubscriptionsForUser(userId);
  if (!subscriptions.length) return { sent: 0 };
  const payloadStr = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url || "/" });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payloadStr);
      sent++;
    } catch (error) {
      const statusCode = error.statusCode;
      if (statusCode === 404 || statusCode === 410) await deletePushSubscription(subscription.user_id, subscription.endpoint);
    }
  }
  return { sent };
}

// server/storage.ts
var IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
var LOGO_MIME_TYPES = IMAGE_MIME_TYPES;
var DIETA_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];
var EXERCICIO_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
var CHAT_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
var FEED_IMAGE_MIME_TYPES = IMAGE_MIME_TYPES;
var LOGO_MAX_BYTES = 1.5 * 1024 * 1024;
var DIETA_MAX_BYTES = 3 * 1024 * 1024;
var EXERCICIO_VIDEO_MAX_BYTES = 3 * 1024 * 1024;
var CHAT_VIDEO_MAX_BYTES = 3 * 1024 * 1024;
var FEED_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
var EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov"
};
function extensionFor(contentType) {
  return EXTENSION_BY_MIME[contentType] ?? "bin";
}
function decodeUpload(dataBase64, contentType, allowed, maxBytes) {
  if (!allowed.includes(contentType)) throw new Error("Tipo de arquivo n\xE3o suportado.");
  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.byteLength === 0) throw new Error("Arquivo vazio.");
  if (buffer.byteLength > maxBytes) throw new Error(`Arquivo muito grande (m\xE1ximo ${(maxBytes / (1024 * 1024)).toFixed(1)}MB).`);
  return buffer;
}
function storageConfig() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}
async function uploadPublicFile(bucket, path, data, contentType) {
  const { url, key } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType, "x-upsert": "true" },
    body: new Uint8Array(data)
  });
  if (!response.ok) throw new Error(`Supabase Storage ${response.status}: ${await response.text()}`);
  return `${url}/storage/v1/object/public/${bucket}/${path}`;
}

// server/routers.ts
var organizationIdInput = z2.object({ organizationId: z2.string().uuid() });
var moduleName = z2.enum(["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"]);
var roleName = z2.enum(["owner", "admin", "manager", "professional", "nutricionista", "viewer"]);
var auditFilterInput = z2.object({ organizationId: z2.string().uuid(), from: z2.string().optional(), to: z2.string().optional(), userId: z2.string().uuid().optional(), entity: z2.string().max(64).optional() });
var auditFilters = (input) => ({ from: input.from ? /* @__PURE__ */ new Date(`${input.from}T00:00:00.000Z`) : void 0, to: input.to ? /* @__PURE__ */ new Date(`${input.to}T23:59:59.999Z`) : void 0, userId: input.userId, entity: input.entity });
var todayKey = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var currentWeekKey = () => {
  const now = /* @__PURE__ */ new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
};
var notifyUser = async (userId, titulo, mensagem) => {
  await createNotificacao({ userId, titulo, mensagem, tipo: "chat" });
  sendPushToUser(userId, { title: titulo, body: mensagem, url: "/" }).catch(() => {
  });
};
var ownerOrAdmin = async (userId, organizationId) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || !["owner", "admin", "manager"].includes(membership.membership.role)) throw new Error("You do not have permission to manage this organization");
  return membership;
};
var hasOrganizationAccess = async (userId, organizationId) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership) throw new Error("Organization access denied");
  return membership;
};
var STAFF_ROLES = ["owner", "admin", "manager", "professional", "nutricionista"];
var MANAGER_ROLES = ["owner", "admin", "manager"];
var TREINO_BLOCKED_ROLES = ["nutricionista"];
var DIETA_BLOCKED_ROLES = ["professional"];
var TREINO_STAFF_ROLES = ["owner", "admin", "manager", "professional"];
var DIETA_STAFF_ROLES = ["owner", "admin", "manager", "nutricionista"];
var notifyStaff = async (organizationId, allowedRoles, titulo, mensagem) => {
  const staffUserIds = await listActiveStaffUserIds(organizationId, allowedRoles);
  await Promise.all(staffUserIds.map((userId) => notifyUser(userId, titulo, mensagem)));
};
var assertStaffOfOrganization = async (userId, organizationId, blockedRoles = []) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.membership.status !== "active" || !STAFF_ROLES.includes(membership.membership.role)) throw new Error("Voc\xEA n\xE3o tem acesso a esta organiza\xE7\xE3o.");
  if (blockedRoles.includes(membership.membership.role)) throw new Error("Seu papel de equipe n\xE3o tem permiss\xE3o para esta a\xE7\xE3o.");
  return membership;
};
var assertStaffForAluno = async (userId, alunoId, blockedRoles = []) => {
  const profile = await getProfileByUserId(alunoId);
  if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
  await assertStaffOfOrganization(userId, profile.organization_id, blockedRoles);
  return profile;
};
var assertStaffForTreino = async (userId, treinoId, blockedRoles = []) => {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino n\xE3o encontrado.");
  if (!treino.organization_id) throw new Error("Treino sem organiza\xE7\xE3o vinculada.");
  await assertStaffOfOrganization(userId, treino.organization_id, blockedRoles);
  return treino;
};
var assertStaffForDieta = async (userId, dietaId, blockedRoles = []) => {
  const dieta = await getDieta(dietaId);
  if (!dieta) throw new Error("Plano alimentar n\xE3o encontrado.");
  if (!dieta.organization_id) throw new Error("Plano alimentar sem organiza\xE7\xE3o vinculada.");
  await assertStaffOfOrganization(userId, dieta.organization_id, blockedRoles);
  return dieta;
};
var DESAFIO_TIPOS = ["sem_doce", "sem_alcool", "consumo_agua", "numero_treinos", "quilometros", "modalidades", "desempenho_dieta", "livre"];
var assertStaffForDesafio = async (userId, desafioId, blockedRoles = []) => {
  const desafio = await getDesafio(desafioId);
  if (!desafio) throw new Error("Desafio n\xE3o encontrado.");
  await assertStaffOfOrganization(userId, desafio.organization_id, blockedRoles);
  return desafio;
};
var assertStaffForCompeticao = async (userId, competicaoId, blockedRoles = []) => {
  const competicao = await getCompeticao(competicaoId);
  if (!competicao) throw new Error("Competi\xE7\xE3o n\xE3o encontrada.");
  await assertStaffOfOrganization(userId, competicao.organization_id, blockedRoles);
  return competicao;
};
var assertStaffForProgresso = async (userId, progressoId, blockedRoles = []) => {
  const registro = await getProgressoSemanal(progressoId);
  if (!registro) throw new Error("Registro de progresso n\xE3o encontrado.");
  if (!registro.organization_id) throw new Error("Registro sem organiza\xE7\xE3o vinculada.");
  await assertStaffOfOrganization(userId, registro.organization_id, blockedRoles);
  return registro;
};
var assertStaffForAtendimento = async (userId, atendimentoId) => {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) throw new Error("Atendimento n\xE3o encontrado.");
  await assertStaffOfOrganization(userId, atendimento.organization_id);
  return atendimento;
};
var assertManagerOfOrganization = async (userId, organizationId) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.membership.status !== "active" || !MANAGER_ROLES.includes(membership.membership.role)) throw new Error("Voc\xEA n\xE3o tem acesso ao CRM desta organiza\xE7\xE3o.");
  return membership;
};
var assertManagerForLead = async (userId, leadId) => {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead n\xE3o encontrado.");
  await assertManagerOfOrganization(userId, lead.organization_id);
  return lead;
};
var assertStaffForTurma = async (userId, turmaId) => {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma n\xE3o encontrada.");
  await assertStaffOfOrganization(userId, turma.organization_id);
  return turma;
};
var assertAlunoSameOrgAsTurma = async (userId, turmaId) => {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma n\xE3o encontrada.");
  const profile = await getProfileByUserId(userId);
  if (!profile?.organization_id || profile.organization_id !== turma.organization_id) throw new Error("Turma n\xE3o encontrada.");
  return turma;
};
var treinoExercicioItem = z2.object({ exercicio_id: z2.string().uuid(), series: z2.number().int().min(1).default(3), repeticoes: z2.string().trim().min(1).default("12"), descanso_seg: z2.number().int().min(0).default(60), descanso_por_serie: z2.string().trim().optional(), observacoes: z2.string().trim().optional() });
var acolhimentoInput = z2.object({
  rotina_diaria: z2.string().trim().max(4e3).optional(),
  experiencias_exercicio: z2.string().trim().max(4e3).optional(),
  experiencias_gostou: z2.string().trim().max(4e3).optional(),
  experiencias_nao_gostou: z2.string().trim().max(4e3).optional(),
  dores_lesoes: z2.string().trim().max(4e3).optional(),
  medicamentos: z2.string().trim().max(4e3).optional(),
  tempo_disponivel: z2.string().trim().max(4e3).optional(),
  estilo_treino: z2.string().trim().max(4e3).optional(),
  exercicios_nao_gosta: z2.string().trim().max(4e3).optional(),
  alimentos_gosta: z2.string().trim().max(4e3).optional(),
  alimentos_nao_gosta: z2.string().trim().max(4e3).optional(),
  alimentacao_rotina: z2.string().trim().max(4e3).optional()
});
var HEALTH_DATA_FIELDS = ["dores_lesoes", "medicamentos"];
var requestMeta = (req) => ({ ipAddress: req.ip, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : void 0 });
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(SUPABASE_ACCESS_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),
    signIn: publicProcedure.input(z2.object({ email: z2.string().email(), password: z2.string().min(8) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "signin"), 10, 5 * 60 * 1e3);
      const result = await signInWithSupabase(input.email, input.password);
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return result;
    }),
    recoverPassword: publicProcedure.input(z2.object({ email: z2.string().email() })).mutation(({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "recover-password"), 5, 15 * 60 * 1e3);
      return createPasswordRecoveryCode(normalizeEmail(input.email));
    }),
    setPassword: publicProcedure.input(z2.object({ email: z2.string().email(), code: z2.string().trim().min(4), password: z2.string().min(8) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "set-password"), 10, 15 * 60 * 1e3);
      const session = await verifyPasswordRecoveryCode(input.email, input.code);
      const supabaseUser = await updateSupabaseUserPassword(session.access_token, input.password);
      const appUser = supabaseUser.email ? await findAppUserByEmail(normalizeEmail(supabaseUser.email)) : null;
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, session.access_token, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return { accessToken: session.access_token, user: supabaseUser, appUser };
    }),
    changePassword: protectedProcedure.input(z2.object({ currentPassword: z2.string().min(8), newPassword: z2.string().min(8) })).mutation(async ({ ctx, input }) => {
      if (!ctx.user.email) throw new Error("Conta sem e-mail associado.");
      if (!ctx.accessToken) throw new Error("Sess\xE3o inv\xE1lida. Fa\xE7a login novamente.");
      await signInWithSupabase(ctx.user.email, input.currentPassword);
      await updateSupabaseUserPassword(ctx.accessToken, input.newPassword);
      return { success: true };
    })
  }),
  // Push (Fase 3 — comunicação): substitui as edge functions Deno
  // "vapid-public-key"/"send-chat-push" do arke-app original. Inerte sem
  // VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY configuradas (mesmo padrão de
  // Sentry/Asaas neste projeto — nunca quebra por falta de credencial).
  push: router({
    publicKey: publicProcedure.query(() => ({ publicKey: getVapidPublicKey() })),
    subscribe: protectedProcedure.input(z2.object({ endpoint: z2.string().url(), keys: z2.object({ p256dh: z2.string(), auth: z2.string() }) })).mutation(({ ctx, input }) => upsertPushSubscription({ userId: ctx.user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })),
    unsubscribe: protectedProcedure.input(z2.object({ endpoint: z2.string().url() })).mutation(({ ctx, input }) => deletePushSubscription(ctx.user.id, input.endpoint))
  }),
  // Inbox in-app (Fase 3): histórico confiável de notificações — existe
  // mesmo para quem nunca ativou push no navegador.
  notificacoes: router({
    minhas: protectedProcedure.query(({ ctx }) => listNotificacoes(ctx.user.id)),
    naoLidas: protectedProcedure.query(async ({ ctx }) => ({ count: await countNotificacoesNaoLidas(ctx.user.id) })),
    marcarLida: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ ctx, input }) => markNotificacaoLida(input.id, ctx.user.id)),
    marcarTodasLidas: protectedProcedure.mutation(({ ctx }) => markAllNotificacoesLidas(ctx.user.id))
  }),
  admin: router({
    status: publicProcedure.query(() => ({ configured: hasSupabaseConfig() })),
    // admin.users/students/lookupCnpj cadastram, editam e excluem clientes
    // do SaaS (inclusive outros Super Admins) — restrito a adminProcedure.
    // Estavam em publicProcedure (sem login nenhum) até esta auditoria.
    lookupCnpj: adminProcedure.input(z2.object({ cnpj: z2.string().min(14).max(18) })).mutation(({ input }) => lookupCnpj(input.cnpj)),
    users: router({
      list: adminProcedure.query(() => listAppUsers()),
      create: adminProcedure.input(z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2).max(80), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable(), profileData: z2.record(z2.string(), z2.string()).optional() })).mutation(({ input }) => createAppUser({ ...input, profile_data: input.profileData, email: normalizeEmail(input.email) })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable(), profileData: z2.record(z2.string(), z2.string()).optional() }) })).mutation(({ input }) => updateAppUser(input.id, { ...input.data, profile_data: input.data.profileData, email: normalizeEmail(input.data.email) })),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppUser(input.id)),
      uploadLogo: adminProcedure.input(z2.object({ contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ input }) => {
        const buffer = decodeUpload(input.dataBase64, input.contentType, LOGO_MIME_TYPES, LOGO_MAX_BYTES);
        const url = await uploadPublicFile("avatars", `logos/${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      })
    }),
    students: router({
      list: adminProcedure.query(() => listAppStudents()),
      create: adminProcedure.input(z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) })).mutation(({ input }) => createAppStudent(input)),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) }) })).mutation(({ input }) => updateAppStudent(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppStudent(input.id))
    })
  }),
  globalLibrary: router({
    list: adminProcedure.query(() => listGlobalLibrary()),
    // Aprovação em lote dos rascunhos gerados por scripts/seed-acervo.ts
    // (ou por qualquer cadastro manual futuro que nasça como rascunho):
    // o Admin Arke revisa e decide o que publica — a IA nunca publica
    // nada por conta própria.
    publish: adminProcedure.input(z2.object({ exerciseIds: z2.array(z2.string().uuid()).default([]), templateIds: z2.array(z2.string().uuid()).default([]), nutritionPlanIds: z2.array(z2.string().uuid()).default([]) })).mutation(async ({ ctx, input }) => {
      const [exercises, templates, nutritionPlans] = await Promise.all([
        publishGlobalExercises(input.exerciseIds, ctx.user.id),
        publishGlobalTemplates(input.templateIds, ctx.user.id),
        publishGlobalNutritionPlans(input.nutritionPlanIds, ctx.user.id)
      ]);
      return { exercises, templates, nutritionPlans };
    }),
    exercises: router({
      create: adminProcedure.input(z2.object({ nome: z2.string().trim().min(2), grupo_muscular: z2.string().trim().min(2), descricao: z2.string().trim().optional(), instrucoes: z2.string().trim().optional(), video_url: z2.string().url().optional(), imagem_url: z2.string().url().optional(), equipamento: z2.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalExercise({ ...input, created_by: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2), grupo_muscular: z2.string().trim().min(2), descricao: z2.string().trim().optional().nullable(), instrucoes: z2.string().trim().optional().nullable(), video_url: z2.string().url().optional().nullable(), imagem_url: z2.string().url().optional().nullable(), equipamento: z2.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalExercise(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalExercise(input.id)),
      uploadVideo: adminProcedure.input(z2.object({ contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ input }) => {
        const buffer = decodeUpload(input.dataBase64, input.contentType, EXERCICIO_VIDEO_MIME_TYPES, EXERCICIO_VIDEO_MAX_BYTES);
        const url = await uploadPublicFile("exercicio-videos", `${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      })
    }),
    groups: router({
      create: adminProcedure.input(z2.object({ nome: z2.string().trim().min(2), ordem: z2.number().int().min(0).default(0) })).mutation(({ input }) => createGlobalGroup(input)),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2), ordem: z2.number().int().min(0) }) })).mutation(({ input }) => updateGlobalGroup(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalGroup(input.id))
    }),
    templates: router({
      create: adminProcedure.input(z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim().default(""), descricao: z2.string().trim().optional(), divisoes: z2.array(z2.string().trim().min(1)).min(1) })).mutation(({ ctx, input }) => createGlobalTemplate({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim(), descricao: z2.string().trim().optional().nullable(), divisoes: z2.array(z2.string().trim().min(1)).min(1) }) })).mutation(({ input }) => updateGlobalTemplate(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalTemplate(input.id))
    }),
    templateExercises: router({
      create: adminProcedure.input(z2.object({ template_id: z2.string().uuid(), divisao: z2.string().trim().min(1), exercicio_id: z2.string().uuid(), ordem: z2.number().int().min(0).default(0), series: z2.number().int().min(1).default(3), repeticoes: z2.string().trim().min(1).default("12"), descanso_seg: z2.number().int().min(0).default(60), descanso_por_serie: z2.string().trim().optional(), observacoes: z2.string().trim().optional() })).mutation(({ input }) => createGlobalTemplateExercise(input)),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ divisao: z2.string().trim().min(1), exercicio_id: z2.string().uuid(), ordem: z2.number().int().min(0), series: z2.number().int().min(1), repeticoes: z2.string().trim().min(1), descanso_seg: z2.number().int().min(0), descanso_por_serie: z2.string().trim().optional().nullable(), observacoes: z2.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalTemplateExercise(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalTemplateExercise(input.id))
    }),
    nutritionPlans: router({
      create: adminProcedure.input(z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim().default(""), objetivo: z2.string().trim().optional(), descricao: z2.string().trim().optional(), instrucoes: z2.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalNutritionPlan({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim(), objetivo: z2.string().trim().optional().nullable(), descricao: z2.string().trim().optional().nullable(), instrucoes: z2.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalNutritionPlan(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalNutritionPlan(input.id))
    }),
    routines: router({
      create: adminProcedure.input(z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim().default(""), descricao: z2.string().trim().optional(), rotina: z2.string().trim().min(2) })).mutation(({ ctx, input }) => createGlobalRoutine({ ...input, criado_por: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), categoria: z2.string().trim(), descricao: z2.string().trim().optional().nullable(), rotina: z2.string().trim().min(2) }) })).mutation(({ input }) => updateGlobalRoutine(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalRoutine(input.id))
    }),
    // Fase 16 (CLAUDE.md §9): agente de IA curador do acervo. Só produz
    // rascunhos — o Admin revisa no formulário e decide se cadastra; nunca
    // grava direto no acervo.
    ai: router({
      status: adminProcedure.query(() => ({ configured: openaiConfigured() })),
      sugerirExercicio: adminProcedure.input(z2.object({ nome: z2.string().trim().min(2), grupoMuscular: z2.string().trim().min(2), equipamento: z2.string().trim().optional() })).mutation(({ input }) => sugerirExercicio(input)),
      sugerirModeloTreino: adminProcedure.input(z2.object({ objetivo: z2.string().trim().min(2), categoria: z2.string().trim().min(1), divisoes: z2.array(z2.string().trim().min(1)).min(1) })).mutation(({ input }) => sugerirModeloTreino(input))
    }),
    accessRules: router({
      upsert: adminProcedure.input(z2.object({ modulo: z2.enum(["academia", "studio", "profissional", "nutricionista"]), plano: z2.string().trim().min(2), habilitado: z2.boolean(), requer_consultoria: z2.boolean().default(true) })).mutation(({ input }) => upsertGlobalAccessRule(input)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalAccessRule(input.id))
    })
  }),
  billing: router({
    // Sem dado sensível — só diz se a chave está configurada e se aponta
    // para sandbox ou produção. Mantido público para a tela de
    // Integrações mostrar o status sem exigir login.
    asaasStatus: publicProcedure.query(() => ({ configured: asaasConfigured(), environment: asaasEnvironment() })),
    // Dados da conta Asaas real e ações que criam cobrança/reconfiguram o
    // webhook: restrito ao Administrador Arke (adminProcedure). Antes
    // disso eram publicProcedure — qualquer pessoa sem login podia criar
    // cobrança arbitrária na conta Asaas real ou trocar o webhook.
    admin: router({
      account: adminProcedure.query(() => getAsaasAccount()),
      payments: adminProcedure.input(z2.object({ limit: z2.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listAsaasPayments(input?.limit ?? 20)),
      createWebhook: adminProcedure.input(z2.object({ url: z2.string().url(), email: z2.string().email() })).mutation(({ input }) => createAsaasWebhook(input))
    }),
    // Cobrança real por organização — isolada: cada organização só vê e
    // gera cobrança para si mesma (verificado no servidor, não só
    // escondido na tela).
    organization: router({
      payments: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return listAsaasPaymentsForOrganization(input.organizationId);
      }),
      gerarCobranca: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), billingType: z2.enum(["PIX", "BOLETO", "CREDIT_CARD"]) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const payment = await createSubscriptionCharge({ organizationId: input.organizationId, billingType: input.billingType });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "asaas_payment", entityId: payment.id, afterJson: { billingType: input.billingType, value: payment.value } });
        return payment;
      })
    })
  }),
  // Fases 14/15 (CLAUDE.md §9): benefícios (Wellhub/TotalPass) e catraca —
  // credenciais que a própria organização informa (o parceiro real é a
  // academia/studio, não a Arke). Restrito a owner/admin, nunca devolve
  // segredo em claro (ver server/integrations.ts).
  integracoes: router({
    beneficios: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return listBenefitIntegrations(input.organizationId);
      }),
      save: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), provider: z2.enum(["wellhub", "totalpass"]), enabled: z2.boolean().default(true), fields: z2.record(z2.string(), z2.string()) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveBenefitIntegration({ organizationId: input.organizationId, provider: input.provider, fields: input.fields, enabled: input.enabled });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "benefit_integration", afterJson: { provider: input.provider, enabled: input.enabled } });
        return result;
      })
    }),
    catraca: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return listTurnstileIntegrationsForOrganization(input.organizationId);
      }),
      save: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid(), brand: z2.enum(["control_id", "topdata", "henry", "dimep", "outra"]), model: z2.string().trim().max(120).optional(), config: z2.record(z2.string(), z2.string()), enabled: z2.boolean().default(true) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveTurnstileIntegration(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "turnstile_integration", afterJson: { brand: input.brand, model: input.model } });
        return result;
      }),
      delete: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await deleteTurnstileIntegration(input.unitId, input.organizationId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "deleted", entity: "turnstile_integration" });
        return result;
      })
    })
  }),
  saas: router({
    organizations: router({
      bySlug: publicProcedure.input(z2.object({ slug: z2.string().trim().toLowerCase().min(1).max(120) })).query(({ input }) => getOrganizationBySlug(input.slug)),
      list: protectedProcedure.query(({ ctx }) => getOrganizationsForUser(ctx.user.id)),
      // create_organization_with_owner (security definer) dá ao p_user_id
      // membership 'owner' de uma organização nova para qualquer client_id
      // que o chamador escolher. Isso é o próprio onboarding (só o Admin
      // Arke implanta um cliente novo) — nunca uma ação de usuário comum.
      // Estava em protectedProcedure: qualquer aluno/profissional logado
      // podia criar organização para o client_id de outra pessoa e virar
      // owner dela. Restrito a adminProcedure nesta auditoria.
      create: adminProcedure.input(z2.object({ clientId: z2.string().uuid(), module: z2.string().trim().min(2).optional(), logoUrl: z2.string().max(1e6).optional(), primaryColor: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), name: z2.string().trim().min(2).max(160), slug: z2.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), plan: z2.enum(SAAS_PLAN_KEYS) })).mutation(({ ctx, input }) => createOrganizationWithOwner({ userId: ctx.user.id, ...input })),
      access: protectedProcedure.input(organizationIdInput).query(({ ctx, input }) => getOrganizationAccess(ctx.user.id, input.organizationId)),
      audit: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return getAuditLogs(input.organizationId, 100, auditFilters(input));
      }),
      auditCsv: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return { filename: `arke-auditoria-${input.organizationId}.csv`, content: auditLogsToCsv(await getAuditLogs(input.organizationId, 500, auditFilters(input))) };
      }),
      auditPdf: protectedProcedure.input(auditFilterInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return { filename: `arke-auditoria-${input.organizationId}.pdf`, contentBase64: auditLogsToPdfBase64(await getAuditLogs(input.organizationId, 500, auditFilters(input))) };
      }),
      pendingInvitations: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return getPendingOrganizationInvitations(input.organizationId);
      }),
      createUnit: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), name: z2.string().trim().min(2).max(160), slug: z2.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), city: z2.string().trim().max(120).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const unit = await createOrganizationUnit(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: unit.id, action: "created", entity: "organization_unit", entityId: unit.id, afterJson: input });
        return unit;
      }),
      archiveUnit: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await archiveOrganizationUnit(input.organizationId, input.unitId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "archived", entity: "organization_unit", entityId: input.unitId, afterJson: result });
        return result;
      }),
      subscription: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return getOrganizationSubscription(input.organizationId);
      }),
      updateProfile: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), name: z2.string().trim().min(2).max(160), logoUrl: z2.string().max(1e6).optional(), primaryColor: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return updateOrganizationProfile(input);
      }),
      updateSubscription: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), plan: z2.enum(SAAS_PLAN_KEYS), status: z2.enum(["trialing", "active", "past_due", "canceled"]).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await updateOrganizationSubscription(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "subscription", afterJson: input });
        return result;
      }),
      onboarding: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return getOrganizationOnboarding(input.organizationId);
      }),
      saveOnboarding: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), currentStep: z2.number().int().min(1).max(4), status: z2.enum(["not_started", "in_progress", "completed"]), city: z2.string().trim().max(120).optional(), defaultUnitName: z2.string().trim().min(2).max(160).optional(), inviteEmail: z2.string().email().optional(), logoUrl: z2.string().url().max(512).optional(), primaryColor: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveOrganizationOnboarding(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "onboarding_branding", afterJson: input });
        return result;
      }),
      updatePolicy: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid(), role: roleName, module: moduleName, canView: z2.boolean(), canManage: z2.boolean() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await updateModulePolicy(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "module_policy", afterJson: input });
        return result;
      }),
      invite: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), email: z2.string().email(), role: z2.enum(["admin", "manager", "professional", "nutricionista", "viewer"]) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const rawToken = randomUUID2();
        const tokenHash = createHash2("sha256").update(rawToken).digest("hex");
        const invitation = await createOrganizationInvitation({ ...input, invitedByUserId: ctx.user.id, email: input.email.toLowerCase(), tokenHash, expiresAt: new Date(Date.now() + 1e3 * 60 * 60 * 72) });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "invitation", entityId: invitation.id, afterJson: { email: input.email.toLowerCase(), role: input.role } });
        return { invitationId: invitation.id, token: rawToken, status: "pending" };
      }),
      revokeInvitation: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), invitationId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await revokeOrganizationInvitation(input.invitationId, input.organizationId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "revoked", entity: "invitation", entityId: input.invitationId });
        return result;
      }),
      acceptInvite: protectedProcedure.input(z2.object({ token: z2.string().min(16).max(128), consentTermos: z2.literal(true) })).mutation(async ({ ctx, input }) => {
        assertRateLimit(rateLimitKey(ctx.req, "accept-team-invite"), 10, 15 * 60 * 1e3);
        if (!ctx.user.email) throw new Error("Authenticated user email is required");
        const result = await acceptOrganizationInvitation({ tokenHash: createHash2("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email });
        if (!await hasConsent(ctx.user.id, "termos_uso_privacidade")) {
          const policy = await getCurrentPrivacyPolicy();
          await recordConsent({ userId: ctx.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
        }
        await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } });
        return { organizationId: result.organizationId, role: result.role, status: "accepted" };
      }),
      listDeletionRequests: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return listDeletionRequests(input.organizationId);
      }),
      fulfillDeletionRequest: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), requestId: z2.string().uuid(), note: z2.string().trim().max(2e3).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const deletionRequest = await getDeletionRequest(input.requestId);
        if (!deletionRequest || deletionRequest.organization_id !== input.organizationId || deletionRequest.status !== "pending" || !deletionRequest.user_id) throw new Error("Solicita\xE7\xE3o n\xE3o encontrada ou j\xE1 resolvida.");
        await fulfillDeletionRequest({ requestId: input.requestId, alunoId: deletionRequest.user_id, resolvedBy: ctx.user.id, note: input.note });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "completed", entity: "data_deletion_request", entityId: input.requestId });
        return { requestId: input.requestId, status: "completed" };
      }),
      rejectDeletionRequest: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), requestId: z2.string().uuid(), note: z2.string().trim().max(2e3).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const rejected = await rejectDeletionRequest({ requestId: input.requestId, organizationId: input.organizationId, resolvedBy: ctx.user.id, note: input.note });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "rejected", entity: "data_deletion_request", entityId: input.requestId });
        return rejected;
      }),
      // Módulo Arke (CLAUDE.md §3/§8): licença de organização — habilita a
      // ACADEMIA a oferecer o método aos próprios alunos. O pacote (99/249/499)
      // segue o mesmo tier do plano-base da organização; alunos individuais
      // só ficam "com Arke" via arke.membership.toggle, e só se isto aqui
      // estiver habilitado.
      arkeModule: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        const [organization, arkeModule, alunosAtivos] = await Promise.all([getOrganization(input.organizationId), getArkeModule(input.organizationId), countAlunosComArkeAtivo(input.organizationId)]);
        return { plan: organization?.plan ?? null, module: arkeModule, alunosAtivos };
      }),
      updateArkeModule: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), enabled: z2.boolean() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const organization = await getOrganization(input.organizationId);
        if (!organization) throw new Error("Organiza\xE7\xE3o n\xE3o encontrada.");
        if (!ORG_PLAN_KEYS.includes(organization.plan)) throw new Error("M\xF3dulo Arke dispon\xEDvel apenas para planos de Academia/Studio.");
        const packageTier = organization.plan;
        const result = await upsertArkeModule({ organizationId: input.organizationId, enabled: input.enabled, packageTier, amountCents: input.enabled ? ARKE_MODULE_PACKAGE_AMOUNTS_CENTS[packageTier] : null });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "arke_module", afterJson: input });
        return result;
      })
    })
  }),
  prescricao: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => STAFF_ROLES.includes(item.membership.role))),
    students: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return listStudentsInOrganization(input.organizationId);
    }),
    updateMatricula: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), unitId: z2.string().uuid().nullable().optional(), matriculaEm: z2.string().datetime().nullable().optional() })).mutation(async ({ ctx, input }) => {
      await assertStaffForAluno(ctx.user.id, input.alunoId);
      return updateStudentMatricula(input.alunoId, { unitId: input.unitId, matriculaEm: input.matriculaEm });
    }),
    exercises: protectedProcedure.query(() => listExercisesCatalog()),
    treinos: router({
      list: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId);
        return listTreinosForAluno(input.alunoId);
      }),
      exercicios: protectedProcedure.input(z2.object({ treinoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.treinoId);
        return listTreinoExercicios(input.treinoId);
      }),
      create: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), titulo: z2.string().trim().min(2), tipo: z2.string().trim().min(1).default("A"), descricao: z2.string().trim().optional() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
        const treino = await createTreino({ aluno_id: input.alunoId, titulo: input.titulo, tipo: input.tipo, descricao: input.descricao || void 0, organization_id: profile.organization_id, criado_por: ctx.user.id });
        if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "created", entity: "treino", entityId: treino.id, afterJson: input });
        return treino;
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), tipo: z2.string().trim().min(1), descricao: z2.string().trim().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const updated = await updateTreino(input.id, input.data);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "updated", entity: "treino", entityId: input.id, beforeJson: treino, afterJson: input.data });
        return updated;
      }),
      saveExercicios: protectedProcedure.input(z2.object({ treinoId: z2.string().uuid(), items: z2.array(treinoExercicioItem) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.treinoId, TREINO_BLOCKED_ROLES);
        return replaceTreinoExercicios(input.treinoId, input.items);
      }),
      publish: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const published = await publishTreino(input.id, ctx.user.id);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "published", entity: "treino", entityId: input.id, afterJson: { versao: published.versao } });
        return published;
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const treino = await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        const result = await deleteTreino(input.id);
        if (treino.organization_id) await recordAuditLog({ organizationId: treino.organization_id, userId: ctx.user.id, action: "deleted", entity: "treino", entityId: input.id, beforeJson: treino });
        return result;
      }),
      fichaPdf: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.id);
        return gerarFichaTreinoPdf(input.id);
      })
    }),
    dietas: router({
      list: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId);
        return listDietasForAluno(input.alunoId);
      }),
      create: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), arquivoUrl: z2.string().url().optional() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, DIETA_BLOCKED_ROLES);
        const dieta = await createDieta({ aluno_id: input.alunoId, titulo: input.titulo, descricao: input.descricao || void 0, arquivo_url: input.arquivoUrl || void 0, organization_id: profile.organization_id, criado_por: ctx.user.id });
        if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "created", entity: "dieta", entityId: dieta.id, afterJson: input });
        return dieta;
      }),
      uploadArquivo: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId, DIETA_BLOCKED_ROLES);
        const buffer = decodeUpload(input.dataBase64, input.contentType, DIETA_MIME_TYPES, DIETA_MAX_BYTES);
        const url = await uploadPublicFile("dietas", `${input.alunoId}/${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional().nullable(), arquivo_url: z2.string().url().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const updated = await updateDieta(input.id, input.data);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "updated", entity: "dieta", entityId: input.id, beforeJson: dieta, afterJson: input.data });
        return updated;
      }),
      publish: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const published = await publishDieta(input.id, ctx.user.id);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "published", entity: "dieta", entityId: input.id, afterJson: { versao: published.versao } });
        return published;
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const dieta = await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        const result = await deleteDieta(input.id);
        if (dieta.organization_id) await recordAuditLog({ organizationId: dieta.organization_id, userId: ctx.user.id, action: "deleted", entity: "dieta", entityId: input.id, beforeJson: dieta });
        return result;
      })
    }),
    // Chat (Fase 3 — comunicação): não é conteúdo do método Arke, é a
    // mesma prescrição de treino/dieta que já é entrega padrão do SaaS —
    // por isso vive fora do router `arke`, sem exigir assertAlunoTemArke.
    chat: router({
      treino: router({
        list: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
          return listMensagensTreino(input.alunoId);
        }),
        send: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), mensagem: z2.string().trim().min(1).max(2e3) })).mutation(async ({ ctx, input }) => {
          const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
          const mensagem = await createMensagemTreino({ aluno_id: input.alunoId, organization_id: profile.organization_id, remetente_id: ctx.user.id, remetente_tipo: "treinador", mensagem: input.mensagem });
          await notifyUser(input.alunoId, "Nova mensagem do seu treinador", input.mensagem.slice(0, 140));
          return mensagem;
        }),
        sendVideo: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ ctx, input }) => {
          const profile = await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
          const buffer = decodeUpload(input.dataBase64, input.contentType, CHAT_VIDEO_MIME_TYPES, CHAT_VIDEO_MAX_BYTES);
          const url = await uploadPublicFile("chat-videos", `${input.alunoId}/${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
          const mensagem = await createMensagemTreino({ aluno_id: input.alunoId, organization_id: profile.organization_id, remetente_id: ctx.user.id, remetente_tipo: "treinador", mensagem: "V\xEDdeo", video_url: url });
          await notifyUser(input.alunoId, "Nova mensagem do seu treinador", "V\xEDdeo enviado");
          return mensagem;
        }),
        markRead: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          await assertStaffForAluno(ctx.user.id, input.alunoId, TREINO_BLOCKED_ROLES);
          return markMensagensTreinoLidas(input.alunoId, "aluno");
        })
      }),
      dieta: router({
        list: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForDieta(ctx.user.id, input.dietaId, DIETA_BLOCKED_ROLES);
          return listMensagensDieta(input.dietaId);
        }),
        send: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid(), mensagem: z2.string().trim().min(1).max(2e3) })).mutation(async ({ ctx, input }) => {
          const dieta = await assertStaffForDieta(ctx.user.id, input.dietaId, DIETA_BLOCKED_ROLES);
          const mensagem = await createMensagemDieta({ dieta_id: input.dietaId, aluno_id: dieta.aluno_id, organization_id: dieta.organization_id, remetente_id: ctx.user.id, remetente_tipo: "nutricionista", mensagem: input.mensagem });
          await notifyUser(dieta.aluno_id, "Nova mensagem da nutri\xE7\xE3o", input.mensagem.slice(0, 140));
          return mensagem;
        }),
        markRead: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          await assertStaffForDieta(ctx.user.id, input.dietaId, DIETA_BLOCKED_ROLES);
          return markMensagensDietaLidas(input.dietaId, "aluno");
        })
      })
    }),
    // Prontuário privado (Fase 3): notas internas da equipe sobre o aluno,
    // nunca expostas a ele — sem procedure nenhuma em `meu`.
    prontuario: router({
      list: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId);
        return listProntuarioObservacoes(input.alunoId);
      }),
      upsert: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), mes: z2.number().int().min(1).max(12), ano: z2.number().int().min(2020).max(2100), observacao: z2.string().trim().max(4e3) })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return upsertProntuarioObservacao({ alunoId: input.alunoId, organizationId: profile.organization_id, mes: input.mes, ano: input.ano, observacao: input.observacao, criadoPor: ctx.user.id });
      })
    }),
    meu: router({
      treinos: protectedProcedure.query(({ ctx }) => listTreinosForAluno(ctx.user.id, true)),
      treinoExercicios: protectedProcedure.input(z2.object({ treinoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        const treino = await getTreino(input.treinoId);
        if (!treino || treino.aluno_id !== ctx.user.id || treino.estado_publicacao !== "publicado") throw new Error("Treino n\xE3o encontrado.");
        return listTreinoExercicios(input.treinoId);
      }),
      dietas: protectedProcedure.query(({ ctx }) => listDietasForAluno(ctx.user.id, true)),
      fichaPdf: protectedProcedure.input(z2.object({ treinoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        const treino = await getTreino(input.treinoId);
        if (!treino || treino.aluno_id !== ctx.user.id || treino.estado_publicacao !== "publicado") throw new Error("Treino n\xE3o encontrado.");
        return gerarFichaTreinoPdf(input.treinoId);
      }),
      chatTreino: protectedProcedure.query(({ ctx }) => listMensagensTreino(ctx.user.id)),
      sendChatTreino: protectedProcedure.input(z2.object({ mensagem: z2.string().trim().min(1).max(2e3) })).mutation(async ({ ctx, input }) => {
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const mensagem = await createMensagemTreino({ aluno_id: ctx.user.id, organization_id: profile.organization_id, remetente_id: ctx.user.id, remetente_tipo: "aluno", mensagem: input.mensagem });
        await notifyStaff(profile.organization_id, TREINO_STAFF_ROLES, `Nova mensagem de ${profile.full_name || "aluno"} (treino)`, input.mensagem.slice(0, 140));
        return mensagem;
      }),
      sendChatTreinoVideo: protectedProcedure.input(z2.object({ contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ ctx, input }) => {
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const buffer = decodeUpload(input.dataBase64, input.contentType, CHAT_VIDEO_MIME_TYPES, CHAT_VIDEO_MAX_BYTES);
        const url = await uploadPublicFile("chat-videos", `${ctx.user.id}/${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        const mensagem = await createMensagemTreino({ aluno_id: ctx.user.id, organization_id: profile.organization_id, remetente_id: ctx.user.id, remetente_tipo: "aluno", mensagem: "V\xEDdeo", video_url: url });
        await notifyStaff(profile.organization_id, TREINO_STAFF_ROLES, `Nova mensagem de ${profile.full_name || "aluno"} (treino)`, "V\xEDdeo enviado");
        return mensagem;
      }),
      markChatTreinoLido: protectedProcedure.mutation(({ ctx }) => markMensagensTreinoLidas(ctx.user.id, "treinador")),
      chatDieta: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        const dieta = await getDieta(input.dietaId);
        if (!dieta || dieta.aluno_id !== ctx.user.id) throw new Error("Plano alimentar n\xE3o encontrado.");
        return listMensagensDieta(input.dietaId);
      }),
      sendChatDieta: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid(), mensagem: z2.string().trim().min(1).max(2e3) })).mutation(async ({ ctx, input }) => {
        const dieta = await getDieta(input.dietaId);
        if (!dieta || dieta.aluno_id !== ctx.user.id) throw new Error("Plano alimentar n\xE3o encontrado.");
        const mensagem = await createMensagemDieta({ dieta_id: input.dietaId, aluno_id: ctx.user.id, organization_id: dieta.organization_id, remetente_id: ctx.user.id, remetente_tipo: "aluno", mensagem: input.mensagem });
        if (dieta.organization_id) {
          const profile = await getProfileByUserId(ctx.user.id);
          await notifyStaff(dieta.organization_id, DIETA_STAFF_ROLES, `Nova mensagem de ${profile?.full_name || "aluno"} (nutri\xE7\xE3o)`, input.mensagem.slice(0, 140));
        }
        return mensagem;
      }),
      markChatDietaLido: protectedProcedure.input(z2.object({ dietaId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const dieta = await getDieta(input.dietaId);
        if (!dieta || dieta.aluno_id !== ctx.user.id) throw new Error("Plano alimentar n\xE3o encontrado.");
        return markMensagensDietaLidas(input.dietaId, "nutricionista");
      })
    }),
    // Evolução (medidas corporais) é histórico, não upsert — qualquer
    // profissional da equipe pode registrar/remover; sem bloqueio por papel.
    progresso: router({
      list: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId);
        return listProgressoSemanal(input.alunoId);
      }),
      create: protectedProcedure.input(z2.object({
        alunoId: z2.string().uuid(),
        data: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        pesoKg: z2.number().positive().max(500).optional(),
        gorduraPercentual: z2.number().min(0).max(100).optional(),
        musculoPercentual: z2.number().min(0).max(100).optional(),
        cinturaCm: z2.number().positive().max(300).optional(),
        quadrilCm: z2.number().positive().max(300).optional(),
        bracoCm: z2.number().positive().max(100).optional(),
        pernaCm: z2.number().positive().max(150).optional(),
        bemEstar: z2.number().int().min(1).max(5).optional(),
        observacoes: z2.string().trim().max(1e3).optional(),
        metaPesoKg: z2.number().positive().max(500).optional()
      })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        const registro = await createProgressoSemanal({
          aluno_id: input.alunoId,
          organization_id: profile.organization_id,
          ...input.data ? { data: input.data } : {},
          peso_kg: input.pesoKg ?? null,
          gordura_percentual: input.gorduraPercentual ?? null,
          musculo_percentual: input.musculoPercentual ?? null,
          cintura_cm: input.cinturaCm ?? null,
          quadril_cm: input.quadrilCm ?? null,
          braco_cm: input.bracoCm ?? null,
          perna_cm: input.pernaCm ?? null,
          bem_estar: input.bemEstar ?? null,
          observacoes: input.observacoes ?? null,
          meta_peso_kg: input.metaPesoKg ?? null
        });
        if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "created", entity: "progresso_semanal", entityId: registro.id, afterJson: input });
        return registro;
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const registro = await assertStaffForProgresso(ctx.user.id, input.id);
        const result = await deleteProgressoSemanal(input.id);
        await recordAuditLog({ organizationId: registro.organization_id, userId: ctx.user.id, action: "deleted", entity: "progresso_semanal", entityId: input.id, beforeJson: registro });
        return result;
      })
    }),
    // Desafios (Fase 2 — engajamento): a equipe cria e acompanha, o aluno só
    // lê (mesma divisão de acesso do arke-app original). `concluido`/
    // `valorAtual` são sempre digitados pela equipe — não há rastreamento
    // automático por dieta/treino registrado ainda.
    desafios: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listDesafios(input.organizationId);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), tipo: z2.enum(DESAFIO_TIPOS).default("livre"), metaValor: z2.number().optional(), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), pontos: z2.number().int().min(0).max(1e4).default(10), paraTodos: z2.boolean().default(true) })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        const desafio = await createDesafio({ organization_id: input.organizationId, titulo: input.titulo, descricao: input.descricao || null, tipo: input.tipo, meta_valor: input.metaValor ?? null, data_inicio: input.dataInicio, data_fim: input.dataFim, pontos: input.pontos, para_todos: input.paraTodos, criado_por: ctx.user.id });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "desafio", entityId: desafio.id, afterJson: input });
        return desafio;
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), tipo: z2.enum(DESAFIO_TIPOS), metaValor: z2.number().optional(), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), pontos: z2.number().int().min(0).max(1e4), paraTodos: z2.boolean() })).mutation(async ({ ctx, input }) => {
        const desafio = await assertStaffForDesafio(ctx.user.id, input.id);
        const updated = await updateDesafio(input.id, { titulo: input.titulo, descricao: input.descricao || null, tipo: input.tipo, meta_valor: input.metaValor ?? null, data_inicio: input.dataInicio, data_fim: input.dataFim, pontos: input.pontos, para_todos: input.paraTodos });
        await recordAuditLog({ organizationId: desafio.organization_id, userId: ctx.user.id, action: "updated", entity: "desafio", entityId: input.id, beforeJson: desafio, afterJson: input });
        return updated;
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const desafio = await assertStaffForDesafio(ctx.user.id, input.id);
        const result = await deleteDesafio(input.id);
        await recordAuditLog({ organizationId: desafio.organization_id, userId: ctx.user.id, action: "deleted", entity: "desafio", entityId: input.id, beforeJson: desafio });
        return result;
      }),
      participantes: router({
        list: protectedProcedure.input(z2.object({ desafioId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForDesafio(ctx.user.id, input.desafioId);
          return listDesafioParticipantes(input.desafioId);
        }),
        add: protectedProcedure.input(z2.object({ desafioId: z2.string().uuid(), alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          const desafio = await assertStaffForDesafio(ctx.user.id, input.desafioId);
          return addDesafioParticipante({ desafioId: input.desafioId, alunoId: input.alunoId, organizationId: desafio.organization_id });
        }),
        remove: protectedProcedure.input(z2.object({ desafioId: z2.string().uuid(), alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          await assertStaffForDesafio(ctx.user.id, input.desafioId);
          return removeDesafioParticipante(input.desafioId, input.alunoId);
        })
      }),
      progresso: router({
        list: protectedProcedure.input(z2.object({ desafioId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForDesafio(ctx.user.id, input.desafioId);
          return listDesafioProgressoForDesafio(input.desafioId);
        }),
        set: protectedProcedure.input(z2.object({ desafioId: z2.string().uuid(), alunoId: z2.string().uuid(), concluido: z2.boolean(), valorAtual: z2.number().optional() })).mutation(async ({ ctx, input }) => {
          const desafio = await assertStaffForDesafio(ctx.user.id, input.desafioId);
          return setDesafioProgresso({ desafioId: input.desafioId, alunoId: input.alunoId, organizationId: desafio.organization_id, concluido: input.concluido, valorAtual: input.valorAtual, concluidoPor: ctx.user.id });
        })
      })
    }),
    // Competições (Fase 2): mesma divisão de acesso de desafios — equipe
    // gerencia, aluno só lê. `metrica` aqui é só um rótulo livre (ex.:
    // "Quilômetros corridos") para o que a equipe está digitando em
    // competicao_pontuacao.valor — não é mais calculada automaticamente.
    competicoes: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listCompeticoes(input.organizationId);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), metrica: z2.string().trim().min(1).max(60).default("Pontua\xE7\xE3o geral"), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), paraTodos: z2.boolean().default(true) })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        const competicao = await createCompeticao({ organization_id: input.organizationId, titulo: input.titulo, descricao: input.descricao || null, metrica: input.metrica, data_inicio: input.dataInicio, data_fim: input.dataFim, para_todos: input.paraTodos, criado_por: ctx.user.id });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "competicao", entityId: competicao.id, afterJson: input });
        return competicao;
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), metrica: z2.string().trim().min(1).max(60), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), paraTodos: z2.boolean() })).mutation(async ({ ctx, input }) => {
        const competicao = await assertStaffForCompeticao(ctx.user.id, input.id);
        const updated = await updateCompeticao(input.id, { titulo: input.titulo, descricao: input.descricao || null, metrica: input.metrica, data_inicio: input.dataInicio, data_fim: input.dataFim, para_todos: input.paraTodos });
        await recordAuditLog({ organizationId: competicao.organization_id, userId: ctx.user.id, action: "updated", entity: "competicao", entityId: input.id, beforeJson: competicao, afterJson: input });
        return updated;
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const competicao = await assertStaffForCompeticao(ctx.user.id, input.id);
        const result = await deleteCompeticao(input.id);
        await recordAuditLog({ organizationId: competicao.organization_id, userId: ctx.user.id, action: "deleted", entity: "competicao", entityId: input.id, beforeJson: competicao });
        return result;
      }),
      participantes: router({
        list: protectedProcedure.input(z2.object({ competicaoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForCompeticao(ctx.user.id, input.competicaoId);
          return listCompeticaoParticipantes(input.competicaoId);
        }),
        add: protectedProcedure.input(z2.object({ competicaoId: z2.string().uuid(), alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          const competicao = await assertStaffForCompeticao(ctx.user.id, input.competicaoId);
          return addCompeticaoParticipante({ competicaoId: input.competicaoId, alunoId: input.alunoId, organizationId: competicao.organization_id });
        }),
        remove: protectedProcedure.input(z2.object({ competicaoId: z2.string().uuid(), alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          await assertStaffForCompeticao(ctx.user.id, input.competicaoId);
          return removeCompeticaoParticipante(input.competicaoId, input.alunoId);
        })
      }),
      pontuacao: router({
        list: protectedProcedure.input(z2.object({ competicaoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
          await assertStaffForCompeticao(ctx.user.id, input.competicaoId);
          return listCompeticaoPontuacaoForCompeticao(input.competicaoId);
        }),
        set: protectedProcedure.input(z2.object({ competicaoId: z2.string().uuid(), alunoId: z2.string().uuid(), valor: z2.number() })).mutation(async ({ ctx, input }) => {
          const competicao = await assertStaffForCompeticao(ctx.user.id, input.competicaoId);
          return setCompeticaoPontuacao({ competicaoId: input.competicaoId, alunoId: input.alunoId, organizationId: competicao.organization_id, valor: input.valor, atualizadoPor: ctx.user.id });
        })
      })
    })
  }),
  arke: router({
    membership: router({
      status: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) return { ativo: false, moduleEnabled: false };
        const [licenca, arkeModule] = await Promise.all([getAlunoArkeLicenca(input.alunoId, profile.organization_id), getArkeModule(profile.organization_id)]);
        return { ativo: licenca?.ativo ?? false, moduleEnabled: arkeModule?.enabled ?? false };
      }),
      toggle: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid(), ativo: z2.boolean() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        if (input.ativo) {
          const arkeModule = await getArkeModule(profile.organization_id);
          if (!arkeModule?.enabled) throw new Error("Sua organiza\xE7\xE3o ainda n\xE3o habilitou o m\xF3dulo Arke.");
        }
        const result = await toggleAlunoArkeLicenca({ userId: input.alunoId, organizationId: profile.organization_id, ativo: input.ativo, ativadoPor: ctx.user.id });
        await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: input.ativo ? "activated" : "deactivated", entity: "aluno_arke_licenca", entityId: input.alunoId });
        return result;
      })
    }),
    // Conteúdo do método propriamente dito (Fase 1c) — cada procedure exige
    // assertAlunoTemArke antes de ler/escrever, então nunca vaza pra quem
    // não tem o módulo ativo, mesmo se a UI esconder a seção.
    meu: router({
      temArke: protectedProcedure.query(({ ctx }) => alunoTemArke(ctx.user.id)),
      checkinHoje: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getCheckinDoDia(ctx.user.id, todayKey());
      }),
      registrarCheckin: protectedProcedure.input(z2.object({ dedicacao: z2.enum(["baixa", "media", "boa", "excelente"]) })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return upsertCheckinDiario({ userId: ctx.user.id, organizationId: profile.organization_id, data: todayKey(), dedicacao: input.dedicacao });
      }),
      avaliacaoSemanaAtual: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getAvaliacaoSemanal(ctx.user.id, currentWeekKey());
      }),
      registrarAvaliacaoSemanal: protectedProcedure.input(z2.object({ sono: z2.number().int().min(1).max(10), produtividade: z2.number().int().min(1).max(10), humor: z2.number().int().min(1).max(10), conquista: z2.string().trim().max(1e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return upsertAvaliacaoSemanal({ userId: ctx.user.id, organizationId: profile.organization_id, semana: currentWeekKey(), ...input });
      }),
      planoTreinoSemanal: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getPlanoTreinoSemanal(ctx.user.id);
      }),
      salvarPlanoTreinoSemanal: protectedProcedure.input(z2.object({ diasTreino: z2.array(z2.string().trim().min(1)).max(7), horarioPreferido: z2.string().trim().max(60).optional(), localTreino: z2.string().trim().max(160).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return upsertPlanoTreinoSemanal({ userId: ctx.user.id, organizationId: profile.organization_id, diasTreino: input.diasTreino, horarioPreferido: input.horarioPreferido, localTreino: input.localTreino });
      }),
      progresso: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return listProgressoSemanal(ctx.user.id);
      })
    }),
    // Feed (Fase 2 — engajamento): mural da comunidade da organização,
    // visível só para quem tem o método Arke ativo. Curtida/comentário
    // exigem o mesmo entitlement; remover o próprio post/comentário não
    // reexige (evita conteúdo órfão que ninguém mais consegue apagar se o
    // aluno for desativado depois).
    feed: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const posts = await listFeedPosts(profile.organization_id);
        const postIds = posts.map((post) => post.id);
        const [likes, comments] = await Promise.all([listFeedLikesForPosts(postIds), listFeedCommentsForPosts(postIds)]);
        const authorIds = Array.from(/* @__PURE__ */ new Set([...posts.map((post) => post.user_id), ...comments.map((comment) => comment.user_id)]));
        const profiles = await listProfileNames(authorIds);
        const nameByUserId = new Map(profiles.map((item) => [item.user_id, item.full_name || "Membro"]));
        const commentsByPost = /* @__PURE__ */ new Map();
        for (const comment of comments) commentsByPost.set(comment.post_id, [...commentsByPost.get(comment.post_id) ?? [], comment]);
        return posts.map((post) => ({
          id: post.id,
          userId: post.user_id,
          authorName: nameByUserId.get(post.user_id) ?? "Membro",
          content: post.content,
          imageUrl: post.image_url,
          createdAt: post.created_at,
          likesCount: likes.filter((like) => like.post_id === post.id).length,
          likedByMe: likes.some((like) => like.post_id === post.id && like.user_id === ctx.user.id),
          comments: (commentsByPost.get(post.id) ?? []).map((comment) => ({ id: comment.id, userId: comment.user_id, authorName: nameByUserId.get(comment.user_id) ?? "Membro", content: comment.content, createdAt: comment.created_at }))
        }));
      }),
      create: protectedProcedure.input(z2.object({ content: z2.string().trim().max(2e3).default(""), imageUrl: z2.string().url().optional() })).mutation(async ({ ctx, input }) => {
        if (!input.content.trim() && !input.imageUrl) throw new Error("Escreva algo ou adicione uma imagem para publicar.");
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return createFeedPost({ user_id: ctx.user.id, organization_id: profile.organization_id, content: input.content.trim(), image_url: input.imageUrl ?? null });
      }),
      uploadImage: protectedProcedure.input(z2.object({ contentType: z2.string(), dataBase64: z2.string() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const buffer = decodeUpload(input.dataBase64, input.contentType, FEED_IMAGE_MIME_TYPES, FEED_IMAGE_MAX_BYTES);
        const url = await uploadPublicFile("feed-images", `${ctx.user.id}/${randomUUID2()}.${extensionFor(input.contentType)}`, buffer, input.contentType);
        return { url };
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const post = await getFeedPost(input.id);
        if (!post || post.user_id !== ctx.user.id) throw new Error("Publica\xE7\xE3o n\xE3o encontrada.");
        return deleteFeedPost(input.id);
      }),
      toggleLike: protectedProcedure.input(z2.object({ postId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const existing = await getFeedLike(input.postId, ctx.user.id);
        if (existing) {
          await deleteFeedLike(input.postId, ctx.user.id);
          return { liked: false };
        }
        await createFeedLike({ postId: input.postId, userId: ctx.user.id, organizationId: profile.organization_id });
        return { liked: true };
      }),
      comments: router({
        create: protectedProcedure.input(z2.object({ postId: z2.string().uuid(), content: z2.string().trim().min(1).max(1e3) })).mutation(async ({ ctx, input }) => {
          await assertAlunoTemArke(ctx.user.id);
          const profile = await getProfileByUserId(ctx.user.id);
          if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
          return createFeedComment({ post_id: input.postId, user_id: ctx.user.id, organization_id: profile.organization_id, content: input.content });
        }),
        delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
          const comment = await getFeedComment(input.id);
          if (!comment || comment.user_id !== ctx.user.id) throw new Error("Coment\xE1rio n\xE3o encontrado.");
          return deleteFeedComment(input.id);
        })
      })
    }),
    // Espelha a leitura do aluno em AlunoDesafios.tsx original: um desafio
    // aparece se for para_todos ou se o aluno foi adicionado como
    // participante; concluido/pontos vêm sempre de desafio_progresso, nunca
    // calculados no cliente.
    desafios: router({
      meus: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const [desafios, participacoes, progresso] = await Promise.all([listDesafios(profile.organization_id), listDesafioParticipantesForAluno(ctx.user.id), listDesafioProgressoForAluno(ctx.user.id)]);
        const participandoIds = new Set(participacoes.map((participante) => participante.desafio_id));
        const progressoByDesafio = new Map(progresso.map((item) => [item.desafio_id, item]));
        return desafios.filter((desafio) => desafio.para_todos || participandoIds.has(desafio.id)).map((desafio) => ({
          id: desafio.id,
          titulo: desafio.titulo,
          descricao: desafio.descricao,
          tipo: desafio.tipo,
          metaValor: desafio.meta_valor,
          dataInicio: desafio.data_inicio,
          dataFim: desafio.data_fim,
          pontos: desafio.pontos,
          concluido: progressoByDesafio.get(desafio.id)?.concluido ?? false,
          valorAtual: progressoByDesafio.get(desafio.id)?.valor_atual ?? null
        }));
      })
    }),
    // Ranking calculado no servidor a partir de valores digitados pela
    // equipe (competicao_pontuacao.valor) — nunca de dados de treino/dieta
    // auto-registrados, que ainda não existem no SaaS novo.
    competicoes: router({
      meus: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const organizationId = profile.organization_id;
        const [competicoes, participacoes, students] = await Promise.all([listCompeticoes(organizationId), listCompeticaoParticipantesForAluno(ctx.user.id), listStudentsInOrganization(organizationId)]);
        const participandoIds = new Set(participacoes.map((participante) => participante.competicao_id));
        const nameByAluno = new Map(students.map((student) => [student.user_id, student.full_name || "Aluno"]));
        const minhas = competicoes.filter((competicao) => competicao.para_todos || participandoIds.has(competicao.id));
        return Promise.all(minhas.map(async (competicao) => {
          const [participantes, pontuacoes] = await Promise.all([
            competicao.para_todos ? Promise.resolve(students.map((student) => ({ aluno_id: student.user_id }))) : listCompeticaoParticipantes(competicao.id),
            listCompeticaoPontuacaoForCompeticao(competicao.id)
          ]);
          const valorByAluno = new Map(pontuacoes.map((item) => [item.aluno_id, item.valor]));
          const ranking = participantes.map((participante) => ({ alunoId: participante.aluno_id, nome: nameByAluno.get(participante.aluno_id) ?? "Aluno", valor: valorByAluno.get(participante.aluno_id) ?? 0 })).sort((a, b) => b.valor - a.valor).map((entry, index) => ({ ...entry, posicao: index + 1 }));
          return { id: competicao.id, titulo: competicao.titulo, descricao: competicao.descricao, metrica: competicao.metrica, dataInicio: competicao.data_inicio, dataFim: competicao.data_fim, ranking };
        }));
      })
    })
  }),
  journey: router({
    inviteMember: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), email: z2.string().email(), fullName: z2.string().trim().min(2) })).mutation(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return inviteMember({ organizationId: input.organizationId, invitedByUserId: ctx.user.id, email: input.email, fullName: input.fullName });
    }),
    pendingInvitations: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return listPendingMemberInvitations(input.organizationId);
    }),
    revokeInvitation: protectedProcedure.input(z2.object({ id: z2.string().uuid(), organizationId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return revokeMemberInvitation(input.id, input.organizationId);
    }),
    acceptInvite: publicProcedure.input(z2.object({ token: z2.string().trim().min(10), password: z2.string().min(8), consentTermos: z2.literal(true) })).mutation(async ({ ctx, input }) => {
      assertRateLimit(rateLimitKey(ctx.req, "accept-member-invite"), 10, 15 * 60 * 1e3);
      const result = await acceptMemberInvitation(input.token, input.password);
      const policy = await getCurrentPrivacyPolicy();
      await recordConsent({ userId: result.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return { accessToken: result.accessToken, user: result.user, organizationId: result.organizationId };
    }),
    getCurrentPrivacyPolicy: publicProcedure.query(() => getCurrentPrivacyPolicy()),
    getConsentStatus: protectedProcedure.query(async ({ ctx }) => ({
      termosUsoPrivacidade: await hasConsent(ctx.user.id, "termos_uso_privacidade"),
      dadosSaude: await hasConsent(ctx.user.id, "dados_saude")
    })),
    myAcolhimento: protectedProcedure.query(({ ctx }) => getAcolhimento(ctx.user.id)),
    submitAcolhimento: protectedProcedure.input(acolhimentoInput.extend({ consentDadosSaude: z2.literal(true).optional() })).mutation(async ({ ctx, input }) => {
      const { consentDadosSaude, ...data } = input;
      const touchesHealthData = HEALTH_DATA_FIELDS.some((field) => data[field] !== void 0);
      if (touchesHealthData && !await hasConsent(ctx.user.id, "dados_saude")) {
        if (!consentDadosSaude) throw new Error("\xC9 necess\xE1rio consentir com o uso dos seus dados de sa\xFAde antes de informar dores, les\xF5es ou medicamentos.");
        const policy = await getCurrentPrivacyPolicy();
        await recordConsent({ userId: ctx.user.id, consentType: "dados_saude", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
      }
      const saved = await upsertAcolhimento(ctx.user.id, data);
      const profile = await getProfileByUserId(ctx.user.id);
      if (profile?.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "updated", entity: "acolhimento", entityId: ctx.user.id });
      return saved;
    }),
    staffAcolhimento: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
      const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
      const acolhimento = await getAcolhimento(input.alunoId);
      if (profile.organization_id) await recordAuditLog({ organizationId: profile.organization_id, userId: ctx.user.id, action: "viewed", entity: "acolhimento", entityId: input.alunoId });
      return acolhimento;
    }),
    requestAccountDeletion: protectedProcedure.input(z2.object({ reason: z2.string().trim().max(2e3).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      return createDeletionRequest({ userId: ctx.user.id, organizationId: profile?.organization_id ?? null, reason: input.reason });
    }),
    myDeletionRequest: protectedProcedure.query(({ ctx }) => getMyDeletionRequest(ctx.user.id))
  }),
  atendimento: router({
    checkIn: protectedProcedure.input(z2.object({ status: z2.enum(["indo_bem", "com_dificuldade", "quero_ajuda"]), observacao: z2.string().trim().max(2e3).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Voc\xEA ainda n\xE3o est\xE1 vinculado a uma organiza\xE7\xE3o.");
      return submitCheckIn({ alunoId: ctx.user.id, organizationId: profile.organization_id, status: input.status, observacao: input.observacao });
    }),
    meusCheckIns: protectedProcedure.query(({ ctx }) => listMyCheckIns(ctx.user.id)),
    pedirAjuda: protectedProcedure.input(z2.object({ descricao: z2.string().trim().max(2e3).optional() })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Voc\xEA ainda n\xE3o est\xE1 vinculado a uma organiza\xE7\xE3o.");
      return requestHelp({ alunoId: ctx.user.id, organizationId: profile.organization_id, descricao: input.descricao });
    }),
    meusAtendimentos: protectedProcedure.query(({ ctx }) => listMyAtendimentos(ctx.user.id)),
    fila: router({
      list: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), status: z2.enum(["aberta", "em_andamento", "resolvida"]).optional() })).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listAtendimentosForOrganization(input.organizationId, input.status);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), alunoId: z2.string().uuid(), prioridade: z2.enum(["rotina", "atencao", "prioritario", "encaminhamento_profissional"]), descricao: z2.string().trim().max(2e3).optional(), prazo: z2.string().datetime().optional() })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return createAtendimento({ organizationId: input.organizationId, alunoId: input.alunoId, origem: "manual", prioridade: input.prioridade, descricao: input.descricao, criadoPor: ctx.user.id, prazo: input.prazo });
      }),
      assign: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForAtendimento(ctx.user.id, input.id);
        return assignAtendimento(input.id, ctx.user.id);
      }),
      resolve: protectedProcedure.input(z2.object({ id: z2.string().uuid(), resultado: z2.string().trim().min(2).max(4e3) })).mutation(async ({ ctx, input }) => {
        await assertStaffForAtendimento(ctx.user.id, input.id);
        return resolveAtendimento(input.id, ctx.user.id, input.resultado);
      })
    })
  }),
  crm: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => MANAGER_ROLES.includes(item.membership.role))),
    indicadores: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid().optional() })).query(async ({ ctx, input }) => {
      await assertManagerOfOrganization(ctx.user.id, input.organizationId);
      return getCrmIndicadores(input.organizationId, input.unitId);
    }),
    leads: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertManagerOfOrganization(ctx.user.id, input.organizationId);
        return listLeadsForOrganization(input.organizationId);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid().optional(), nome: z2.string().trim().min(2).max(160), telefone: z2.string().trim().max(40).optional(), email: z2.string().email().optional(), origem: z2.string().trim().max(80).optional(), interesse: z2.string().trim().max(160).optional(), responsavelId: z2.string().uuid().optional(), notas: z2.string().trim().max(4e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertManagerOfOrganization(ctx.user.id, input.organizationId);
        return createLead({ organizationId: input.organizationId, unitId: input.unitId, nome: input.nome, telefone: input.telefone, email: input.email, origem: input.origem, interesse: input.interesse, responsavelId: input.responsavelId ?? ctx.user.id, notas: input.notas, criadoPor: ctx.user.id });
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2).max(160).optional(), telefone: z2.string().trim().max(40).optional().nullable(), email: z2.string().email().optional().nullable(), origem: z2.string().trim().max(80).optional().nullable(), interesse: z2.string().trim().max(160).optional().nullable(), unitId: z2.string().uuid().optional().nullable(), responsavelId: z2.string().uuid().optional().nullable(), notas: z2.string().trim().max(4e3).optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.id);
        return updateLead(input.id, input.data);
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.id);
        return deleteLead(input.id);
      }),
      moverEstagio: protectedProcedure.input(z2.object({ id: z2.string().uuid(), estagio: z2.enum(["novo", "contato_feito", "visita_agendada"]) })).mutation(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.id);
        return moverEstagioLead(input.id, input.estagio);
      }),
      marcarPerdido: protectedProcedure.input(z2.object({ id: z2.string().uuid(), motivo: z2.string().trim().min(2).max(500) })).mutation(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.id);
        return marcarLeadPerdido(input.id, input.motivo);
      }),
      converter: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.id);
        return converterLead(input.id, ctx.user.id);
      }),
      atividades: protectedProcedure.input(z2.object({ leadId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertManagerForLead(ctx.user.id, input.leadId);
        return listLeadAtividades(input.leadId);
      }),
      criarNota: protectedProcedure.input(z2.object({ leadId: z2.string().uuid(), descricao: z2.string().trim().min(2).max(4e3) })).mutation(async ({ ctx, input }) => {
        const lead = await assertManagerForLead(ctx.user.id, input.leadId);
        return createLeadNota({ leadId: input.leadId, organizationId: lead.organization_id, descricao: input.descricao, criadoPor: ctx.user.id });
      })
    })
  }),
  gestao: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => MANAGER_ROLES.includes(item.membership.role))),
    indicadores: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      return getGestaoIndicadores(input.organizationId);
    })
  }),
  academia: router({
    frequencia: router({
      registrar: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return registrarFrequencia({ alunoId: input.alunoId, organizationId: profile.organization_id, unitId: profile.unit_id ?? void 0, origem: "manual", registradoPor: ctx.user.id });
      }),
      listOrganization: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listFrequenciaForOrganization(input.organizationId);
      }),
      listAluno: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForAluno(ctx.user.id, input.alunoId);
        return listFrequenciaForAluno(input.alunoId);
      }),
      minhas: protectedProcedure.query(({ ctx }) => listFrequenciaForAluno(ctx.user.id))
    })
  }),
  studio: router({
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => STAFF_ROLES.includes(item.membership.role))),
    turmas: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listTurmasForOrganization(input.organizationId);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid().optional(), nome: z2.string().trim().min(2), descricao: z2.string().trim().optional(), professorId: z2.string().uuid().optional(), limiteVagas: z2.number().int().min(1).max(500), duracaoMin: z2.number().int().min(15).max(480).default(60) })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return createTurma({ organization_id: input.organizationId, unit_id: input.unitId || void 0, nome: input.nome, descricao: input.descricao || void 0, professor_id: input.professorId || void 0, limite_vagas: input.limiteVagas, duracao_min: input.duracaoMin, criado_por: ctx.user.id });
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2), descricao: z2.string().trim().optional().nullable(), professorId: z2.string().uuid().optional().nullable(), limiteVagas: z2.number().int().min(1).max(500), duracaoMin: z2.number().int().min(15).max(480), status: z2.enum(["ativa", "inativa"]) }) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.id);
        return updateTurma(input.id, { nome: input.data.nome, descricao: input.data.descricao, professor_id: input.data.professorId, limite_vagas: input.data.limiteVagas, duracao_min: input.data.duracaoMin, status: input.data.status });
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.id);
        return deleteTurma(input.id);
      }),
      horarios: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.turmaId);
        return listTurmaHorarios(input.turmaId);
      }),
      saveHorarios: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid(), items: z2.array(z2.object({ diaSemana: z2.number().int().min(0).max(6), horaInicio: z2.string().regex(/^\d{2}:\d{2}$/) })) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.turmaId);
        return replaceTurmaHorarios(input.turmaId, input.items.map((item) => ({ dia_semana: item.diaSemana, hora_inicio: item.horaInicio })));
      }),
      reservas: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid(), data: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => {
        await assertStaffForTurma(ctx.user.id, input.turmaId);
        return listReservasForTurmaData(input.turmaId, input.data);
      }),
      cancelarReserva: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        const reserva = await getReserva(input.id);
        if (!reserva) throw new Error("Reserva n\xE3o encontrada.");
        await assertStaffOfOrganization(ctx.user.id, reserva.organization_id);
        return cancelarReservaStaff(input.id);
      })
    }),
    turmasDisponiveis: protectedProcedure.query(async ({ ctx }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) return [];
      return listTurmasAtivas(profile.organization_id);
    }),
    horariosDaTurma: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid() })).query(async ({ ctx, input }) => {
      await assertAlunoSameOrgAsTurma(ctx.user.id, input.turmaId);
      return listTurmaHorarios(input.turmaId);
    }),
    vagasDisponiveis: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid(), data: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => {
      await assertAlunoSameOrgAsTurma(ctx.user.id, input.turmaId);
      return getVagasDisponiveis(input.turmaId, input.data);
    }),
    reservar: protectedProcedure.input(z2.object({ turmaId: z2.string().uuid(), data: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile?.organization_id) throw new Error("Voc\xEA ainda n\xE3o est\xE1 vinculado a uma organiza\xE7\xE3o.");
      return reservarVaga({ turmaId: input.turmaId, alunoId: ctx.user.id, organizationId: profile.organization_id, data: input.data });
    }),
    minhasReservas: protectedProcedure.query(({ ctx }) => listMinhasReservas(ctx.user.id)),
    cancelarMinhaReserva: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ ctx, input }) => cancelarReserva(input.id, ctx.user.id))
  })
});

// server/_core/context.ts
var PLATFORM_ADMIN_EMAILS = ["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"];
async function createContext(opts) {
  let user = null;
  const authorization = opts.req.headers.authorization;
  const cookieHeader = opts.req.headers.cookie ?? "";
  const cookieToken = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SUPABASE_ACCESS_COOKIE}=`))?.slice(SUPABASE_ACCESS_COOKIE.length + 1);
  const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : cookieToken;
  if (bearer) {
    try {
      const supabaseUser = await authenticateSupabaseAccessToken(bearer);
      const email = supabaseUser.email ?? null;
      user = {
        id: supabaseUser.id,
        email,
        name: String(supabaseUser.user_metadata?.name ?? email ?? "Usu\xE1rio"),
        role: email && PLATFORM_ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "user"
      };
    } catch {
      user = null;
    }
  }
  return {
    req: opts.req,
    res: opts.res,
    user,
    accessToken: bearer ?? null
  };
}

// server/access.ts
import { randomUUID as randomUUID3 } from "node:crypto";
var normalize = (value) => typeof value === "string" ? value.trim() : "";
function registerAccessRoutes(app) {
  app.post("/api/v1/access/check-in", async (req, res) => {
    const expectedKey = process.env.CATRACA_API_KEY;
    const providedKey = normalize(req.header("x-arke-device-key"));
    if (expectedKey && providedKey !== expectedKey) {
      return res.status(401).json({ ok: false, code: "INVALID_DEVICE_KEY", message: "Dispositivo n\xE3o autorizado." });
    }
    const body = req.body ?? {};
    const academyId = normalize(body.academyId);
    const organizationId = normalize(body.organizationId);
    const unitId = normalize(body.unitId);
    const studentId = normalize(body.studentId);
    const document = normalize(body.document);
    const deviceId = normalize(body.deviceId);
    const provider = body.provider;
    if (!academyId || !studentId && !document) {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "academyId e studentId ou document s\xE3o obrigat\xF3rios." });
    }
    const configured = Boolean(expectedKey);
    const eventId = `access_${randomUUID3()}`;
    let decision;
    let message;
    if (!configured) {
      const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
      decision = denied ? "denied" : "allowed";
      message = denied ? "Acesso bloqueado para esta credencial." : "Acesso liberado.";
    } else {
      try {
        const profile = studentId ? await getProfileByUserId(studentId) : null;
        if (!profile || profile.organization_id !== organizationId) {
          decision = "denied";
          message = "Aluno n\xE3o encontrado nesta organiza\xE7\xE3o.";
        } else if (profile.status !== "active") {
          decision = "denied";
          message = "Matr\xEDcula n\xE3o est\xE1 ativa.";
        } else {
          decision = "allowed";
          message = "Acesso liberado.";
        }
      } catch (error) {
        captureException2(error, { route: "access.check-in", organizationId, studentId });
        decision = "denied";
        message = "N\xE3o foi poss\xEDvel verificar a matr\xEDcula no momento.";
      }
    }
    if (decision === "allowed" && organizationId && studentId) {
      registrarFrequencia({ alunoId: studentId, organizationId, unitId: unitId || void 0, origem: "catraca" }).catch(() => {
      });
    }
    return res.status(200).json({
      ok: true,
      mode: configured ? "configured" : "demo",
      eventId,
      decision,
      academyId,
      unitId: unitId || null,
      studentId: studentId || null,
      document: document || null,
      deviceId,
      provider,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message
    });
  });
}

// server/asaasWebhook.ts
import { timingSafeEqual } from "node:crypto";
function tokenMatches(received, expected) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}
function registerAsaasWebhook(app) {
  app.post("/api/webhooks/asaas", async (req, res) => {
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN ?? "";
    const receivedToken = String(req.header("asaas-access-token") ?? "");
    if (!expectedToken || !tokenMatches(receivedToken, expectedToken)) return res.status(401).json({ received: false, error: "invalid webhook token" });
    const body = req.body;
    if (!body?.id || !body.event) return res.status(400).json({ received: false, error: "invalid event" });
    try {
      const result = await persistAsaasEvent({ eventId: body.id, event: body.event, occurredAt: body.dateCreated, payload: body });
      if (!result.duplicate && body.payment) await upsertAsaasPayment(body.payment, body.event);
      return res.status(200).json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("[Asaas webhook] failed", error);
      return res.status(500).json({ received: false });
    }
  });
}

// server/automacaoCron.ts
import { timingSafeEqual as timingSafeEqual2 } from "node:crypto";

// server/arkeBilling.ts
async function runArkeRepasseMensal() {
  const resultado = { organizacoesCobradas: 0, organizacoesSemAlunoAtivo: 0, falhas: 0 };
  const hoje = /* @__PURE__ */ new Date();
  const mesAtual = hoje.toISOString().slice(0, 7);
  for (const arkeModule of await listArkeModulesEnabled()) {
    if (arkeModule.last_repasse_charged_at?.slice(0, 7) === mesAtual) continue;
    try {
      const alunosAtivos = await countAlunosComArkeAtivo(arkeModule.organization_id);
      if (alunosAtivos === 0) {
        resultado.organizacoesSemAlunoAtivo += 1;
        continue;
      }
      const customerId = await getOrCreateAsaasCustomerForOrganization(arkeModule.organization_id);
      const dueDate = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 5).toISOString().slice(0, 10);
      const payment = await createAsaasPayment({
        customer: customerId,
        value: alunosAtivos * ARKE_ALUNO_WHOLESALE_CENTS / 100,
        dueDate,
        billingType: "UNDEFINED",
        description: `Repasse M\xF3dulo Arke \u2014 ${alunosAtivos} aluno(s) com Arke x R$59,90`
      });
      await upsertAsaasPayment(payment, "PAYMENT_CREATED", arkeModule.organization_id);
      await markArkeRepasseCharged(arkeModule.organization_id, hoje.toISOString().slice(0, 10));
      resultado.organizacoesCobradas += 1;
    } catch (error) {
      captureException2(error, { job: "arke_repasse_mensal", organizationId: arkeModule.organization_id });
      resultado.falhas += 1;
    }
  }
  return resultado;
}

// server/arkeLembretes.ts
var diasAtras = (dias) => {
  const data = /* @__PURE__ */ new Date();
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
};
async function lembretesParaAluno(userId, hoje) {
  const lembretes = [];
  const diaSemana = hoje.getUTCDay();
  if (diaSemana === 0 && !await hasProgressoSemanalDesde(userId, diasAtras(7))) {
    lembretes.push({ titulo: "\u{1F4CA} Hora do progresso semanal!", mensagem: "Domingo \xE9 dia de registrar sua evolu\xE7\xE3o. Atualize suas medidas no app." });
  }
  if (diaSemana === 1) {
    lembretes.push({ titulo: "\u{1F525} Nova semana, novos objetivos!", mensagem: "Comece a semana com o p\xE9 direito. Bora treinar?" });
  }
  if (!await hasCheckinDesde(userId, diasAtras(7))) {
    lembretes.push({ titulo: "\u26A0\uFE0F Revis\xE3o de rotina", mensagem: "Faz uma semana sem check-in. Que tal revisar sua rotina com seu profissional?" });
  } else if (!await hasCheckinDesde(userId, diasAtras(3))) {
    lembretes.push({ titulo: "\u{1F4AA} Bora treinar!", mensagem: "J\xE1 fazem 3 dias sem check-in. Const\xE2ncia \xE9 o que mais importa \u2014 vamos l\xE1!" });
  }
  return lembretes;
}
async function runArkeLembretesDiarios() {
  const resultado = { alunosProcessados: 0, lembretesEnviados: 0, falhas: 0 };
  const hoje = /* @__PURE__ */ new Date();
  for (const arkeModule of await listArkeModulesEnabled()) {
    for (const userId of await listAlunosComArkeAtivoIds(arkeModule.organization_id)) {
      resultado.alunosProcessados += 1;
      try {
        for (const lembrete of await lembretesParaAluno(userId, hoje)) {
          await createNotificacao({ userId, titulo: lembrete.titulo, mensagem: lembrete.mensagem, tipo: "lembrete" });
          sendPushToUser(userId, { title: lembrete.titulo, body: lembrete.mensagem, url: "/" }).catch(() => {
          });
          resultado.lembretesEnviados += 1;
        }
      } catch (error) {
        captureException2(error, { job: "arke_lembretes_diarios", userId });
        resultado.falhas += 1;
      }
    }
  }
  return resultado;
}

// server/automacaoCron.ts
function tokenMatches2(received, expected) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual2(receivedBuffer, expectedBuffer);
}
function registerAutomacaoCron(app) {
  app.get("/api/cron/automacao", async (req, res) => {
    const expectedToken = process.env.CRON_SECRET ?? "";
    const receivedToken = String(req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expectedToken || !tokenMatches2(receivedToken, expectedToken)) return res.status(401).json({ ok: false, error: "unauthorized" });
    try {
      const [resultado, arkeRepasse, arkeLembretes] = await Promise.all([runAutomacaoDiaria(), runArkeRepasseMensal(), runArkeLembretesDiarios()]);
      return res.status(200).json({ ok: true, ...resultado, arkeRepasse, arkeLembretes });
    } catch (error) {
      captureException2(error, { job: "automacao_diaria" });
      return res.status(500).json({ ok: false });
    }
  });
}

// serverless/entry.ts
initErrorMonitoring();
function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerAccessRoutes(app);
  registerAsaasWebhook(app);
  registerAutomacaoCron(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path }) {
        captureException2(error, { path });
      }
    })
  );
  return app;
}
var entry_default = createApp();
export {
  createApp,
  entry_default as default
};

// serverless/entry.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
import { z as z2 } from "zod";
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";

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
  return `${bucket}:${req.ip || "unknown"}`;
}

// server/db.ts
import { createHash as createHash2 } from "node:crypto";

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
    if (String(error).includes("asaas_webhook_events_event_id_key")) return { duplicate: true };
    throw error;
  }
}
var EVENT_STATUS_OVERRIDE = {
  PAYMENT_DELETED: "DELETED",
  PAYMENT_PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED"
};
async function upsertAsaasPayment(payment, event, organizationId) {
  const asaasId = String(payment.id ?? "");
  if (!asaasId) return;
  const status = EVENT_STATUS_OVERRIDE[event] ?? payment.status ?? event;
  await supabaseRequest("asaas_payments", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ asaas_id: asaasId, ...organizationId ? { organization_id: organizationId } : {}, customer_id: payment.customer ?? null, value: payment.value ?? null, billing_type: payment.billingType ?? null, due_date: payment.dueDate ?? null, status, invoice_url: payment.invoiceUrl ?? null, bank_slip_url: payment.bankSlipUrl ?? null, raw_payload: payment, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, "?on_conflict=asaas_id");
}
async function listAsaasPaymentsForOrganization(organizationId, limit = 20) {
  return supabaseRequest("asaas_payments", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=updated_at.desc&limit=${limit}`);
}
async function listAllAsaasPayments(input = {}) {
  if (!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))) return [];
  const limit = input.limit ?? 200;
  const statusFilter = input.status ? `&status=eq.${encodeURIComponent(input.status)}` : "";
  return supabaseRequest("asaas_payments", {}, `?select=*&order=updated_at.desc&limit=${limit}${statusFilter}`);
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

// server/supabaseAdmin.ts
import { createHash, randomUUID } from "node:crypto";

// server/_core/env.ts
var ENV = {
  isProduction: process.env.NODE_ENV === "production"
};

// server/supabaseAdmin.ts
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
var id = () => randomUUID();
async function authenticateSupabaseAccessToken(accessToken) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Supabase access token inv\xE1lido");
  return response.json();
}
async function updateSupabaseUserPassword(accessToken, password) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/user`, { method: "PUT", headers: { apikey: key, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!response.ok) throw new Error("N\xE3o foi poss\xEDvel definir a nova senha. O link pode ter expirado \u2014 solicite a recupera\xE7\xE3o novamente.");
  return response.json();
}
async function findAppUserByEmail(email) {
  const rows = await request("app_users", {}, `?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  return rows[0] ?? null;
}
async function signInWithSupabase(email, password) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }) });
  if (!response.ok) throw new Error("Usu\xE1rio ou senha inv\xE1lidos.");
  const data = await response.json();
  const appUsers = await request("app_users", {}, `?select=*&email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user, appUser: appUsers[0] ?? null };
}
async function createSupabaseAuthUser(email, name) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "invite", email: normalizeEmail(email), data: { name } }) });
  if (!response.ok) throw new Error(`Falha ao gerar convite Supabase: ${await response.text()}`);
  return response.json();
}
async function listAppUsers() {
  return request("app_users", {}, "?select=*&order=created_at.asc");
}
async function createAppUser(input) {
  const authInvite = await createSupabaseAuthUser(input.email, input.name);
  const rows = await request("app_users", { method: "POST", body: JSON.stringify({ id: id(), ...input }) });
  await sendInviteEmail(input.email, input.name, input.username, authInvite.action_link);
  await notifyAdmins("Novo cadastro no Arke", `<p>O cliente <strong>${input.name}</strong> foi cadastrado no m\xF3dulo ${input.module}.</p><p>Usu\xE1rio: ${input.username}</p>`);
  return rows[0];
}
async function updateAppUser(idValue, input) {
  const rows = await request("app_users", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro atualizado no Arke", `<p>O cadastro <strong>${input.name ?? idValue}</strong> foi atualizado pela administra\xE7\xE3o.</p>`);
  return rows[0];
}
async function deleteAppUser(idValue) {
  await request("saas_organizations", { method: "DELETE" }, `?client_id=eq.${encodeURIComponent(idValue)}`);
  await request("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usu\xE1rio <strong>${idValue}</strong> foi removido pela administra\xE7\xE3o, junto com qualquer organiza\xE7\xE3o vinculada.</p>`);
  return { id: idValue };
}
async function createPasswordRecoveryCode(email) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "recovery", email: normalizeEmail(email) }) });
  if (!response.ok) return { sent: true };
  const data = await response.json();
  const code = data.email_otp ?? data.token;
  if (code) await sendEmail(normalizeEmail(email), "Recupera\xE7\xE3o de senha \u2014 Arke", `<p>Recebemos uma solicita\xE7\xE3o de recupera\xE7\xE3o de senha.</p><p>Use este c\xF3digo no portal Arke para definir uma nova senha:</p><h2>${code}</h2><p>Este c\xF3digo expira em 1 hora e s\xF3 pode ser usado uma vez. Se voc\xEA n\xE3o fez essa solicita\xE7\xE3o, ignore este e-mail.</p>`);
  return { sent: true };
}
async function verifyPasswordRecoveryCode(email, code) {
  const { url, key } = config();
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
    request("exercicios", {}, "?select=*&order=created_at.desc"),
    request("grupos_musculares", {}, "?select=*&order=ordem.asc,nome.asc"),
    request("treino_templates", {}, "?select=*&order=created_at.desc"),
    request("treino_template_exercicios", {}, "?select=*&order=divisao.asc,ordem.asc"),
    request("acervo_planos_alimentares", {}, "?select=*&order=created_at.desc"),
    request("acervo_rotinas", {}, "?select=*&order=created_at.desc"),
    request("acervo_acesso_regras", {}, "?select=*&order=modulo.asc,plano.asc")
  ]);
  return { exercises, groups, templates, templateExercises, nutritionPlans, routines, accessRules };
}
async function createGlobalExercise(input) {
  const rows = await request("exercicios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalExercise(idValue, input) {
  const rows = await request("exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalExercise(idValue) {
  await request("exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalGroup(input) {
  const rows = await request("grupos_musculares", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalGroup(idValue, input) {
  const rows = await request("grupos_musculares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalGroup(idValue) {
  await request("grupos_musculares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalTemplate(input) {
  const rows = await request("treino_templates", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalTemplate(idValue, input) {
  const rows = await request("treino_templates", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalTemplate(idValue) {
  await request("treino_templates", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalTemplateExercise(input) {
  const rows = await request("treino_template_exercicios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalTemplateExercise(idValue, input) {
  const rows = await request("treino_template_exercicios", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalTemplateExercise(idValue) {
  await request("treino_template_exercicios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createGlobalNutritionPlan(input) {
  const rows = await request("acervo_planos_alimentares", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalNutritionPlan(idValue, input) {
  const rows = await request("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalNutritionPlan(idValue) {
  await request("acervo_planos_alimentares", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
var inFilter = (ids) => `id=in.(${ids.map(encodeURIComponent).join(",")})`;
async function publishGlobalExercises(ids, userId) {
  if (!ids.length) return [];
  return request("exercicios", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function publishGlobalTemplates(ids, userId) {
  if (!ids.length) return [];
  return request("treino_templates", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function publishGlobalNutritionPlans(ids, userId) {
  if (!ids.length) return [];
  return request("acervo_planos_alimentares", { method: "PATCH", body: JSON.stringify({ estado_publicacao: "publicado", publicado_por: userId, publicado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?${inFilter(ids)}`);
}
async function createGlobalRoutine(input) {
  const rows = await request("acervo_rotinas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateGlobalRoutine(idValue, input) {
  const rows = await request("acervo_rotinas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteGlobalRoutine(idValue) {
  await request("acervo_rotinas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function upsertGlobalAccessRule(input) {
  const rows = await request("acervo_acesso_regras", { method: "POST", body: JSON.stringify(input), headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
  return rows[0];
}
async function getGlobalAccessRule(modulo, plano) {
  const rows = await request("acervo_acesso_regras", {}, `?select=*&modulo=eq.${encodeURIComponent(modulo)}&plano=eq.${encodeURIComponent(plano)}&limit=1`);
  return rows[0] ?? null;
}
async function deleteGlobalAccessRule(idValue) {
  await request("acervo_acesso_regras", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function getProfileByUserId(userId) {
  const rows = await request("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function listStudentsInOrganization(organizationId) {
  return request("profiles", {}, `?select=user_id,full_name,organization_id,status,unit_id,matricula_em&organization_id=eq.${encodeURIComponent(organizationId)}&order=full_name.asc`);
}
async function updateStudentMatricula(alunoId, organizationId, input) {
  const body = {};
  if (input.unitId !== void 0) {
    if (input.unitId !== null) {
      const unit = await request("saas_units", {}, `?select=id&id=eq.${encodeURIComponent(input.unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
      if (!unit[0]) throw new Error("Unidade n\xE3o encontrada nesta organiza\xE7\xE3o.");
    }
    body.unit_id = input.unitId;
  }
  if (input.matriculaEm !== void 0) body.matricula_em = input.matriculaEm;
  const rows = await request("profiles", { method: "PATCH", body: JSON.stringify(body) }, `?user_id=eq.${encodeURIComponent(alunoId)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return rows[0];
}
async function getArkeModule(organizationId) {
  const rows = await request("saas_arke_module", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertArkeModule(input) {
  const body = { organization_id: input.organizationId, enabled: input.enabled, package_tier: input.packageTier ?? null, amount_cents: input.amountCents ?? null, enabled_at: input.enabled ? (/* @__PURE__ */ new Date()).toISOString() : null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("saas_arke_module", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id");
  return rows[0];
}
async function listArkeModulesEnabled() {
  return request("saas_arke_module", {}, "?select=*&enabled=eq.true");
}
async function markArkeRepasseCharged(organizationId, chargedOn) {
  await request("saas_arke_module", { method: "PATCH", body: JSON.stringify({ last_repasse_charged_at: chargedOn }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}`);
}
async function getAlunoArkeLicenca(userId, organizationId) {
  const rows = await request("aluno_arke_licenca", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0] ?? null;
}
async function countAlunosComArkeAtivo(organizationId) {
  const rows = await request("aluno_arke_licenca", { headers: { Prefer: "count=exact" } }, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&ativo=eq.true`);
  return rows.length;
}
async function countAllAlunosComArkeAtivo() {
  if (!hasSupabaseConfig()) return 0;
  const rows = await request("aluno_arke_licenca", {}, "?select=id&ativo=eq.true");
  return rows.length;
}
async function toggleAlunoArkeLicenca(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const body = { organization_id: input.organizationId, user_id: input.userId, ativo: input.ativo, ativado_em: input.ativo ? now : void 0, desativado_em: input.ativo ? void 0 : now, ativado_por: input.ativadoPor, updated_at: now };
  const rows = await request("aluno_arke_licenca", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=organization_id,user_id");
  return rows[0];
}
async function listAlunosComArkeAtivoIds(organizationId) {
  const rows = await request("aluno_arke_licenca", {}, `?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&ativo=eq.true`);
  return rows.map((row) => row.user_id);
}
async function getCheckinDoDia(userId, data) {
  const rows = await request("checkin_diario", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&data=eq.${encodeURIComponent(data)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertCheckinDiario(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, data: input.data, dedicacao: input.dedicacao, ...input.horasSono !== void 0 ? { horas_sono: input.horasSono } : {} };
  const rows = await request("checkin_diario", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,data");
  return rows[0];
}
async function hasCheckinDesde(userId, desde) {
  const rows = await request("checkin_diario", {}, `?select=data&user_id=eq.${encodeURIComponent(userId)}&data=gte.${encodeURIComponent(desde)}&limit=1`);
  return rows.length > 0;
}
async function listCheckinsPeriodo(userId, desde, ate) {
  return request("checkin_diario", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&data=gte.${encodeURIComponent(desde)}&data=lte.${encodeURIComponent(ate)}&order=data.asc`);
}
async function getAvaliacaoSemanal(userId, semana) {
  const rows = await request("avaliacao_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&semana=eq.${encodeURIComponent(semana)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertAvaliacaoSemanal(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, semana: input.semana, sono: input.sono, produtividade: input.produtividade, humor: input.humor, conquista: input.conquista ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("avaliacao_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,semana");
  return rows[0];
}
async function listAvaliacoesSemanaisPeriodo(userId, desde, ate) {
  return request("avaliacao_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&semana=gte.${encodeURIComponent(desde)}&semana=lte.${encodeURIComponent(ate)}&order=semana.asc`);
}
async function getPlanoTreinoSemanal(userId) {
  const rows = await request("plano_treino_semanal", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertPlanoTreinoSemanal(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, dias_treino: input.diasTreino, horario_preferido: input.horarioPreferido ?? null, local_treino: input.localTreino ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("plano_treino_semanal", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id");
  return rows[0];
}
async function createTreinoCalendario(input) {
  const body = { aluno_id: input.alunoId, organization_id: input.organizationId, data: input.data, tipos: input.tipos, duracao_min: input.duracaoMin ?? null, distancia_km: input.distanciaKm ?? null, intensidade: input.intensidade ?? "moderada", detalhes: input.detalhes ?? null, observacoes: input.observacoes ?? null };
  const [row] = await request("treino_calendario", { method: "POST", body: JSON.stringify(body) });
  return row;
}
async function listTreinoCalendarioPeriodo(alunoId, desde, ate) {
  return request("treino_calendario", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&data=gte.${encodeURIComponent(desde)}&data=lte.${encodeURIComponent(ate)}&order=data.desc`);
}
async function getDietaAdesaoDoDia(alunoId, data) {
  const rows = await request("dieta_adesao", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&data=eq.${encodeURIComponent(data)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertDietaAdesao(input) {
  const body = { aluno_id: input.alunoId, dieta_id: input.dietaId, organization_id: input.organizationId, data: input.data, adesao_percentual: input.adesaoPercentual, consumiu_doce: input.consumiuDoce, consumiu_alcool: input.consumiuAlcool, agua_ml: input.aguaMl ?? null, observacoes: input.observacoes ?? null };
  const rows = await request("dieta_adesao", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=aluno_id,data");
  return rows[0];
}
async function listDietaAdesaoPeriodo(alunoId, desde, ate) {
  return request("dieta_adesao", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&data=gte.${encodeURIComponent(desde)}&data=lte.${encodeURIComponent(ate)}&order=data.desc`);
}
async function getOrCreateCompromissoSemanal(userId, organizationId, semana) {
  const rows = await request("compromisso_semanal", { method: "POST", body: JSON.stringify({ user_id: userId, organization_id: organizationId, semana }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,semana");
  return rows[0];
}
async function listCompromissoMetas(compromissoId) {
  return request("compromisso_metas", {}, `?select=*&compromisso_id=eq.${encodeURIComponent(compromissoId)}&order=created_at.asc`);
}
async function createCompromissoMeta(input) {
  const [row] = await request("compromisso_metas", { method: "POST", body: JSON.stringify({ compromisso_id: input.compromissoId, texto: input.texto }) });
  return row;
}
async function setCompromissoMetaConcluida(id2, concluida) {
  const rows = await request("compromisso_metas", { method: "PATCH", body: JSON.stringify({ concluida }) }, `?id=eq.${encodeURIComponent(id2)}`);
  return rows[0];
}
async function getCompromissoMetaComDono(id2) {
  const rows = await request("compromisso_metas", {}, `?select=*,compromisso_semanal(user_id)&id=eq.${encodeURIComponent(id2)}&limit=1`);
  return rows[0] ?? null;
}
async function listCompromissoMetasPeriodo(userId, desde, ate) {
  return request("compromisso_metas", {}, `?select=*,compromisso_semanal!inner(semana,user_id)&compromisso_semanal.user_id=eq.${encodeURIComponent(userId)}&compromisso_semanal.semana=gte.${encodeURIComponent(desde)}&compromisso_semanal.semana=lte.${encodeURIComponent(ate)}`);
}
var PROGRESSO_SEMANAL_SELECT = "id,aluno_id,organization_id,data,peso_kg,gordura_percentual,musculo_percentual,cintura_cm,quadril_cm,braco_cm,perna_cm,bem_estar,observacoes,meta_peso_kg,meta,meta_gordura,meta_gordura_valor,meta_musculo,meta_musculo_valor,created_at";
async function listProgressoSemanal(alunoId) {
  return request("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&aluno_id=eq.${encodeURIComponent(alunoId)}&order=data.asc`);
}
async function hasProgressoSemanalDesde(alunoId, desde) {
  const rows = await request("progresso_semanal", {}, `?select=id&aluno_id=eq.${encodeURIComponent(alunoId)}&data=gte.${encodeURIComponent(desde)}&limit=1`);
  return rows.length > 0;
}
async function getProgressoSemanal(idValue) {
  const rows = await request("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createProgressoSemanal(input) {
  const rows = await request("progresso_semanal", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteProgressoSemanal(idValue) {
  await request("progresso_semanal", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listProgressoSemanalPeriodo(alunoId, desde, ate) {
  return request("progresso_semanal", {}, `?select=${PROGRESSO_SEMANAL_SELECT}&aluno_id=eq.${encodeURIComponent(alunoId)}&data=gte.${encodeURIComponent(desde)}&data=lte.${encodeURIComponent(ate)}&order=data.desc`);
}
async function getAlunoPerfil(userId) {
  const rows = await request("aluno_perfil", {}, `?select=id,user_id,organization_id,meta_semanal_dias&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function getAlunoObjetivosRecente(userId) {
  const rows = await request("aluno_objetivos", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1`);
  return rows[0] ?? null;
}
async function createAlunoObjetivos(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, objetivos: input.objetivos, conquistas: input.conquistas ?? null, dificuldades: input.dificuldades ?? null, visao_3_meses: input.visao3Meses ?? null, visao_3_anos: input.visao3Anos ?? null, proxima_revisao: input.proximaRevisao ?? null };
  const [row] = await request("aluno_objetivos", { method: "POST", body: JSON.stringify(body) });
  return row;
}
async function getAlunoValoresRecente(userId) {
  const rows = await request("aluno_valores", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=1`);
  return rows[0] ?? null;
}
async function createAlunoValores(input) {
  const body = { user_id: input.userId, organization_id: input.organizationId, valores: input.valores, validade: input.validade ?? null };
  const [row] = await request("aluno_valores", { method: "POST", body: JSON.stringify(body) });
  return row;
}
var idsInFilter = (column, ids) => `${column}=in.(${ids.map(encodeURIComponent).join(",")})`;
async function listFeedPosts(organizationId, limit = 50) {
  return request("feed_posts", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=${limit}`);
}
async function getFeedPost(idValue) {
  const rows = await request("feed_posts", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedPost(input) {
  const rows = await request("feed_posts", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteFeedPost(idValue) {
  await request("feed_posts", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listFeedLikesForPosts(postIds) {
  if (!postIds.length) return [];
  return request("feed_likes", {}, `?select=*&${idsInFilter("post_id", postIds)}`);
}
async function getFeedLike(postId, userId) {
  const rows = await request("feed_likes", {}, `?select=*&post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedLike(input) {
  const rows = await request("feed_likes", { method: "POST", body: JSON.stringify({ post_id: input.postId, user_id: input.userId, organization_id: input.organizationId }) });
  return rows[0];
}
async function deleteFeedLike(postId, userId) {
  await request("feed_likes", { method: "DELETE" }, `?post_id=eq.${encodeURIComponent(postId)}&user_id=eq.${encodeURIComponent(userId)}`);
  return { postId, userId };
}
async function listFeedCommentsForPosts(postIds) {
  if (!postIds.length) return [];
  return request("feed_comments", {}, `?select=*&${idsInFilter("post_id", postIds)}&order=created_at.asc`);
}
async function getFeedComment(idValue) {
  const rows = await request("feed_comments", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createFeedComment(input) {
  const rows = await request("feed_comments", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function deleteFeedComment(idValue) {
  await request("feed_comments", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
function periodoTimestamp(desde, ate) {
  return `created_at=gte.${encodeURIComponent(`${desde}T00:00:00`)}&created_at=lte.${encodeURIComponent(`${ate}T23:59:59`)}`;
}
async function listFeedPostsPeriodoAluno(userId, desde, ate) {
  return request("feed_posts", {}, `?select=created_at&user_id=eq.${encodeURIComponent(userId)}&${periodoTimestamp(desde, ate)}`);
}
async function listFeedLikesPeriodoAluno(userId, desde, ate) {
  return request("feed_likes", {}, `?select=created_at&user_id=eq.${encodeURIComponent(userId)}&${periodoTimestamp(desde, ate)}`);
}
async function listFeedCommentsPeriodoAluno(userId, desde, ate) {
  return request("feed_comments", {}, `?select=created_at&user_id=eq.${encodeURIComponent(userId)}&${periodoTimestamp(desde, ate)}`);
}
async function listProfileNames(userIds) {
  if (!userIds.length) return [];
  return request("profiles", {}, `?select=user_id,full_name&${idsInFilter("user_id", userIds)}`);
}
async function listMensagensTreino(alunoId) {
  return request("mensagens_treino", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.asc`);
}
async function createMensagemTreino(input) {
  const rows = await request("mensagens_treino", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function markMensagensTreinoLidas(alunoId, remetenteTipo) {
  await request("mensagens_treino", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?aluno_id=eq.${encodeURIComponent(alunoId)}&remetente_tipo=eq.${remetenteTipo}&lida=eq.false`);
}
async function listMensagensDieta(dietaId) {
  return request("mensagens_dieta", {}, `?select=*&dieta_id=eq.${encodeURIComponent(dietaId)}&order=created_at.asc`);
}
async function createMensagemDieta(input) {
  const rows = await request("mensagens_dieta", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function markMensagensDietaLidas(dietaId, remetenteTipo) {
  await request("mensagens_dieta", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?dieta_id=eq.${encodeURIComponent(dietaId)}&remetente_tipo=eq.${remetenteTipo}&lida=eq.false`);
}
async function getPushSubscriptionsForUser(userId) {
  return request("push_subscriptions", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}`);
}
async function upsertPushSubscription(input) {
  const body = { user_id: input.userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
  const rows = await request("push_subscriptions", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=user_id,endpoint");
  return rows[0];
}
async function deletePushSubscription(userId, endpoint) {
  await request("push_subscriptions", { method: "DELETE" }, `?user_id=eq.${encodeURIComponent(userId)}&endpoint=eq.${encodeURIComponent(endpoint)}`);
}
async function listNotificacoes(userId, limit = 30) {
  return request("notificacoes", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`);
}
async function countNotificacoesNaoLidas(userId) {
  const rows = await request("notificacoes", {}, `?select=id&user_id=eq.${encodeURIComponent(userId)}&lida=eq.false`);
  return rows.length;
}
async function createNotificacao(input) {
  const rows = await request("notificacoes", { method: "POST", body: JSON.stringify({ user_id: input.userId, titulo: input.titulo, mensagem: input.mensagem ?? null, tipo: input.tipo ?? "info" }) });
  return rows[0];
}
async function markNotificacaoLida(id2, userId) {
  await request("notificacoes", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?id=eq.${encodeURIComponent(id2)}&user_id=eq.${encodeURIComponent(userId)}`);
}
async function markAllNotificacoesLidas(userId) {
  await request("notificacoes", { method: "PATCH", body: JSON.stringify({ lida: true }) }, `?user_id=eq.${encodeURIComponent(userId)}&lida=eq.false`);
}
async function listProntuarioObservacoes(alunoId) {
  return request("prontuario_observacoes", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=ano.desc,mes.desc`);
}
async function upsertProntuarioObservacao(input) {
  const body = { aluno_id: input.alunoId, organization_id: input.organizationId, mes: input.mes, ano: input.ano, observacao: input.observacao, criado_por: input.criadoPor, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("prontuario_observacoes", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=aluno_id,mes,ano");
  return rows[0];
}
async function listDesafios(organizationId) {
  return request("desafios", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=data_fim.desc`);
}
async function getDesafio(idValue) {
  const rows = await request("desafios", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createDesafio(input) {
  const rows = await request("desafios", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateDesafio(idValue, input) {
  const rows = await request("desafios", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteDesafio(idValue) {
  await request("desafios", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listDesafioParticipantes(desafioId) {
  return request("desafio_participantes", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`);
}
async function listDesafioParticipantesForAluno(alunoId) {
  return request("desafio_participantes", {}, `?select=desafio_id&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function addDesafioParticipante(input) {
  const rows = await request("desafio_participantes", { method: "POST", body: JSON.stringify({ desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}
async function removeDesafioParticipante(desafioId, alunoId) {
  await request("desafio_participantes", { method: "DELETE" }, `?desafio_id=eq.${encodeURIComponent(desafioId)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  return { desafioId, alunoId };
}
async function listDesafioProgressoForDesafio(desafioId) {
  return request("desafio_progresso", {}, `?select=*&desafio_id=eq.${encodeURIComponent(desafioId)}`);
}
async function listDesafioProgressoForAluno(alunoId) {
  return request("desafio_progresso", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function setDesafioProgresso(input) {
  const body = { desafio_id: input.desafioId, aluno_id: input.alunoId, organization_id: input.organizationId, concluido: input.concluido, valor_atual: input.valorAtual ?? null, concluido_por: input.concluido ? input.concluidoPor ?? null : null, concluido_em: input.concluido ? (/* @__PURE__ */ new Date()).toISOString() : null, origem: input.origem, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("desafio_progresso", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=desafio_id,aluno_id");
  return rows[0];
}
async function listCompeticoes(organizationId) {
  return request("competicoes", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=data_inicio.desc`);
}
async function getCompeticao(idValue) {
  const rows = await request("competicoes", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createCompeticao(input) {
  const rows = await request("competicoes", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateCompeticao(idValue, input) {
  const rows = await request("competicoes", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteCompeticao(idValue) {
  await request("competicoes", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listCompeticaoParticipantes(competicaoId) {
  return request("competicao_participantes", {}, `?select=*&competicao_id=eq.${encodeURIComponent(competicaoId)}`);
}
async function listCompeticaoParticipantesForAluno(alunoId) {
  return request("competicao_participantes", {}, `?select=competicao_id&aluno_id=eq.${encodeURIComponent(alunoId)}`);
}
async function addCompeticaoParticipante(input) {
  const rows = await request("competicao_participantes", { method: "POST", body: JSON.stringify({ competicao_id: input.competicaoId, aluno_id: input.alunoId, organization_id: input.organizationId }), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=competicao_id,aluno_id");
  return rows[0];
}
async function removeCompeticaoParticipante(competicaoId, alunoId) {
  await request("competicao_participantes", { method: "DELETE" }, `?competicao_id=eq.${encodeURIComponent(competicaoId)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  return { competicaoId, alunoId };
}
async function listCompeticaoPontuacaoForCompeticao(competicaoId) {
  return request("competicao_pontuacao", {}, `?select=*&competicao_id=eq.${encodeURIComponent(competicaoId)}`);
}
async function setCompeticaoPontuacao(input) {
  const body = { competicao_id: input.competicaoId, aluno_id: input.alunoId, organization_id: input.organizationId, valor: input.valor, atualizado_por: input.atualizadoPor ?? null, origem: input.origem, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const rows = await request("competicao_pontuacao", { method: "POST", body: JSON.stringify(body), headers: { Prefer: "return=representation,resolution=merge-duplicates" } }, "?on_conflict=competicao_id,aluno_id");
  return rows[0];
}
async function listExercisesCatalog() {
  return request("exercicios", {}, "?select=id,nome,grupo_muscular,video_url&estado_publicacao=eq.publicado&order=nome.asc");
}
async function listTreinosForAluno(alunoId, publishedOnly = false) {
  return request("treinos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`);
}
async function getTreino(idValue) {
  const rows = await request("treinos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createTreino(input) {
  const rows = await request("treinos", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateTreino(idValue, input) {
  const rows = await request("treinos", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteTreino(idValue) {
  await request("treinos", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listTreinoExercicios(treinoId) {
  return request("treino_exercicios", {}, `?select=*&treino_id=eq.${encodeURIComponent(treinoId)}&order=ordem.asc`);
}
async function replaceTreinoExercicios(treinoId, items) {
  await request("treino_exercicios", { method: "DELETE" }, `?treino_id=eq.${encodeURIComponent(treinoId)}`);
  if (!items.length) return [];
  return request("treino_exercicios", { method: "POST", body: JSON.stringify(items.map((item, index) => ({ ...item, treino_id: treinoId, ordem: index }))) });
}
async function publishTreino(treinoId, autorId) {
  const treino = await getTreino(treinoId);
  if (!treino) throw new Error("Treino n\xE3o encontrado.");
  const exercicios = await listTreinoExercicios(treinoId);
  const versao = treino.estado_publicacao === "rascunho" ? treino.versao : treino.versao + 1;
  const publicado_em = (/* @__PURE__ */ new Date()).toISOString();
  const atualizado = await updateTreino(treinoId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request("treino_revisoes", { method: "POST", body: JSON.stringify({ treino_id: treinoId, versao, conteudo: { treino, exercicios }, autor_id: autorId, organization_id: treino.organization_id }) });
  return atualizado;
}
async function listDietasForAluno(alunoId, publishedOnly = false) {
  return request("dietas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}${publishedOnly ? "&estado_publicacao=eq.publicado" : ""}&order=created_at.desc`);
}
async function getDieta(idValue) {
  const rows = await request("dietas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createDieta(input) {
  const rows = await request("dietas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateDieta(idValue, input) {
  const rows = await request("dietas", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteDieta(idValue) {
  await request("dietas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function publishDieta(dietaId, autorId) {
  const dieta = await getDieta(dietaId);
  if (!dieta) throw new Error("Plano alimentar n\xE3o encontrado.");
  const versao = dieta.estado_publicacao === "rascunho" ? dieta.versao : dieta.versao + 1;
  const publicado_em = (/* @__PURE__ */ new Date()).toISOString();
  const atualizado = await updateDieta(dietaId, { estado_publicacao: "publicado", versao, publicado_por: autorId, publicado_em });
  await request("dieta_revisoes", { method: "POST", body: JSON.stringify({ dieta_id: dietaId, versao, conteudo: dieta, autor_id: autorId, organization_id: dieta.organization_id }) });
  return atualizado;
}
async function listMembershipPlans(organizationId) {
  return request("org_membership_plans", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=nome.asc`);
}
async function createMembershipPlan(input) {
  const rows = await request("org_membership_plans", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, nome: input.nome, valor_mensal: input.valorMensal, periodicidade: input.periodicidade ?? "mensal" }) });
  return rows[0];
}
async function updateMembershipPlan(id2, organizationId, data) {
  const body = {};
  if (data.nome !== void 0) body.nome = data.nome;
  if (data.valorMensal !== void 0) body.valor_mensal = data.valorMensal;
  if (data.periodicidade !== void 0) body.periodicidade = data.periodicidade;
  if (data.ativo !== void 0) body.ativo = data.ativo;
  const rows = await request("org_membership_plans", { method: "PATCH", body: JSON.stringify(body) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  if (!rows[0]) throw new Error("Plano n\xE3o encontrado.");
  return rows[0];
}
async function listAlunos(organizationId) {
  return request("alunos", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc`);
}
async function findAlunoByEmail(organizationId, email) {
  const rows = await request("alunos", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&email=eq.${encodeURIComponent(normalizeEmail(email))}&limit=1`);
  return rows[0] ?? null;
}
async function findAlunoByAuthUserId(authUserId) {
  const rows = await request("alunos", {}, `?select=*&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`);
  return rows[0] ?? null;
}
async function createAluno(input) {
  const rows = await request("alunos", { method: "POST", body: JSON.stringify({
    organization_id: input.organizationId,
    unit_id: input.unitId || void 0,
    plano_id: input.planoId || void 0,
    nome: input.nome,
    cpf: input.cpf || void 0,
    email: input.email ? normalizeEmail(input.email) : void 0,
    telefone: input.telefone || void 0,
    data_nascimento: input.dataNascimento || void 0,
    responsavel_nome: input.responsavelNome || void 0,
    responsavel_cpf: input.responsavelCpf || void 0,
    valor_mensal: input.valorMensal ?? void 0,
    dia_vencimento: input.diaVencimento ?? void 0,
    origem: input.origem ?? "manual",
    criado_por: input.criadoPor || void 0
  }) });
  return rows[0];
}
async function updateAluno(id2, organizationId, data) {
  const rows = await request("alunos", { method: "PATCH", body: JSON.stringify(data) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  if (!rows[0]) throw new Error("Aluno n\xE3o encontrado.");
  return rows[0];
}
async function createImportBatch(input) {
  const rows = await request("import_batches", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, entity: input.entity, file_name: input.fileName, total_rows: input.totalRows, valid_rows: input.validRows, error_rows: input.errorRows, errors: input.errors, uploaded_by: input.uploadedBy }) });
  return rows[0];
}
async function finalizeImportBatch(id2, organizationId, input) {
  const rows = await request("import_batches", { method: "PATCH", body: JSON.stringify({ status: "committed", committed_at: (/* @__PURE__ */ new Date()).toISOString(), valid_rows: input.validRows, error_rows: input.errorRows, errors: input.errors }) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return rows[0];
}
async function listImportBatches(organizationId) {
  return request("import_batches", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=50`);
}
async function getOrganizationName(organizationId) {
  const rows = await request("saas_organizations", {}, `?select=id,name&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0]?.name ?? "sua academia";
}
async function findPendingMemberInvitation(organizationId, email) {
  const rows = await request("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&email=eq.${encodeURIComponent(normalizeEmail(email))}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}
async function listPendingMemberInvitations(organizationId) {
  return request("member_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}
async function inviteMember(input) {
  const email = normalizeEmail(input.email);
  const existing = await findPendingMemberInvitation(input.organizationId, email);
  if (existing) throw new Error("J\xE1 existe um convite pendente para este e-mail nesta organiza\xE7\xE3o.");
  const aluno = await findAlunoByEmail(input.organizationId, email) ?? await createAluno({ organizationId: input.organizationId, nome: input.fullName, email, origem: "manual", criadoPor: input.invitedByUserId });
  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 7);
  const rows = await request("member_invitations", { method: "POST", body: JSON.stringify({
    organization_id: input.organizationId,
    aluno_id: aluno.id,
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
  const rows = await request("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite n\xE3o encontrado ou j\xE1 utilizado.");
  return rows[0];
}
async function findMemberInvitationByToken(token) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await request("member_invitations", {}, `?select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}
async function createSupabaseUserWithPassword(email, password, fullName) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password, email_confirm: true, user_metadata: { full_name: fullName } }) });
  if (!response.ok) throw new Error("N\xE3o foi poss\xEDvel criar sua conta. Verifique se este e-mail j\xE1 n\xE3o est\xE1 cadastrado.");
  return response.json();
}
async function acceptMemberInvitation(token, password) {
  const invitation = await findMemberInvitationByToken(token);
  if (!invitation) throw new Error("C\xF3digo de convite inv\xE1lido ou j\xE1 utilizado.");
  if (new Date(invitation.expires_at).getTime() < Date.now()) throw new Error("Este convite expirou. Pe\xE7a para reenviarem o convite.");
  const authUser = await createSupabaseUserWithPassword(invitation.email, password, invitation.full_name);
  await request("profiles", { method: "PATCH", body: JSON.stringify({ full_name: invitation.full_name, organization_id: invitation.organization_id, status: "active", matricula_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?user_id=eq.${encodeURIComponent(authUser.id)}`);
  await request("alunos", { method: "PATCH", body: JSON.stringify({ auth_user_id: authUser.id }) }, `?id=eq.${encodeURIComponent(invitation.aluno_id)}`);
  const accepted = await request("member_invitations", { method: "PATCH", body: JSON.stringify({ status: "accepted" }) }, `?id=eq.${encodeURIComponent(invitation.id)}&status=eq.pending`);
  if (!accepted[0]) throw new Error("Este convite j\xE1 foi utilizado.");
  await request("leads", { method: "PATCH", body: JSON.stringify({ estagio: "matriculado", convertido_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?member_invitation_id=eq.${encodeURIComponent(invitation.id)}&estagio=eq.convite_enviado`);
  const session = await signInWithSupabase(invitation.email, password);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user, organizationId: invitation.organization_id };
}
async function getAcolhimento(alunoId) {
  const rows = await request("reuniao_acolhimento", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&limit=1`);
  return rows[0] ?? null;
}
async function upsertAcolhimento(alunoId, data) {
  const rows = await request("reuniao_acolhimento", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...data, aluno_id: alunoId, criado_por: alunoId, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, "?on_conflict=aluno_id");
  return rows[0];
}
var CHECKIN_PRIORIDADE = {
  com_dificuldade: "atencao",
  quero_ajuda: "prioritario"
};
async function createCheckIn(input) {
  const rows = await request("check_ins", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, status: input.status, observacao: input.observacao || void 0 }) });
  return rows[0];
}
async function listMyCheckIns(alunoId) {
  return request("check_ins", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}
async function findOpenAtendimento(alunoId, origem) {
  const rows = await request("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&origem=eq.${origem}&status=in.(aberta,em_andamento)&limit=1`);
  return rows[0] ?? null;
}
async function createAtendimento(input) {
  const rows = await request("atendimentos", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, aluno_id: input.alunoId, origem: input.origem, origem_check_in_id: input.origemCheckInId || void 0, prioridade: input.prioridade, descricao: input.descricao || void 0, criado_por: input.criadoPor || void 0, prazo: input.prazo || void 0 }) });
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
  return request("atendimentos", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=created_at.desc&limit=20`);
}
async function listAtendimentosForOrganization(organizationId, status) {
  return request("atendimentos", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=created_at.asc`);
}
async function getAtendimento(idValue) {
  const rows = await request("atendimentos", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function assignAtendimento(idValue, responsavelId) {
  const rows = await request("atendimentos", { method: "PATCH", body: JSON.stringify({ responsavel_id: responsavelId, status: "em_andamento" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function resolveAtendimento(idValue, resolvidoPor, resultado) {
  const rows = await request("atendimentos", { method: "PATCH", body: JSON.stringify({ status: "resolvida", resultado, resolvido_por: resolvidoPor, resolvido_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
var PRIORIDADE_ORDEM = ["rotina", "atencao", "prioritario", "encaminhamento_profissional"];
var MAX_ESCALONAMENTOS = 3;
var PRAZO_APOS_ESCALONAMENTO_MS = 1e3 * 60 * 60 * 24 * 2;
var DIAS_SEM_CHECKIN = 7;
var DIAS_CONVITE_PENDENTE = 3;
async function listAtendimentosVencidos() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return request("atendimentos", {}, `?select=*&status=in.(aberta,em_andamento)&prazo=lt.${encodeURIComponent(now)}&escalonamentos_count=lt.${MAX_ESCALONAMENTOS}`);
}
async function escalateAtendimento(atendimento) {
  const proximoIndex = Math.min(PRIORIDADE_ORDEM.indexOf(atendimento.prioridade) + 1, PRIORIDADE_ORDEM.length - 1);
  const rows = await request("atendimentos", { method: "PATCH", body: JSON.stringify({
    prioridade: PRIORIDADE_ORDEM[proximoIndex],
    escalonamentos_count: atendimento.escalonamentos_count + 1,
    prazo: new Date(Date.now() + PRAZO_APOS_ESCALONAMENTO_MS).toISOString()
  }) }, `?id=eq.${encodeURIComponent(atendimento.id)}`);
  return rows[0];
}
async function listAlunosSemCheckIn(dias = DIAS_SEM_CHECKIN) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1e3).toISOString();
  const candidatos = await request("profiles", {}, `?select=user_id,organization_id,created_at&status=eq.active&organization_id=not.is.null&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.user_id).join(",");
  const recentes = await request("check_ins", {}, `?select=aluno_id&aluno_id=in.(${ids})&created_at=gte.${encodeURIComponent(cutoff)}`);
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
  return request("member_invitations", {}, `?select=*&status=eq.pending&lembrete_enviado_em=is.null&created_at=lt.${encodeURIComponent(cutoff)}&expires_at=gt.${encodeURIComponent(now)}`);
}
async function resendInvitationReminder(invitation) {
  const rawToken = randomUUID();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 1e3 * 60 * 60 * 24 * 7).toISOString();
  await request("member_invitations", { method: "PATCH", body: JSON.stringify({ token_hash: tokenHash, expires_at: expiresAt, lembrete_enviado_em: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(invitation.id)}`);
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
    request("profiles", {}, `?select=user_id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request("saas_memberships", {}, `?select=id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request("treinos", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request("dietas", {}, `?select=aluno_id,estado_publicacao&organization_id=eq.${encodeURIComponent(organizationId)}`),
    request("atendimentos", {}, `?select=status,prioridade,prazo&organization_id=eq.${encodeURIComponent(organizationId)}&status=in.(aberta,em_andamento)`),
    request("atendimentos", {}, `?select=created_at,resolvido_em&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.resolvida&resolvido_em=gte.${encodeURIComponent(trintaDiasAtras)}`)
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
  const rows = await request("frequencia_registros", { method: "POST", body: JSON.stringify({ aluno_id: input.alunoId, organization_id: input.organizationId, unit_id: input.unitId || void 0, origem: input.origem, registrado_por: input.registradoPor || void 0 }) });
  return rows[0];
}
async function listFrequenciaForAluno(alunoId, limit = 30) {
  return request("frequencia_registros", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&order=registrado_em.desc&limit=${limit}`);
}
async function listFrequenciaForOrganization(organizationId, limit = 100) {
  return request("frequencia_registros", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=registrado_em.desc&limit=${limit}`);
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
  return request("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=nome.asc`);
}
async function listTurmasAtivas(organizationId) {
  return request("turmas", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.ativa&order=nome.asc`);
}
async function getTurma(idValue) {
  const rows = await request("turmas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createTurma(input) {
  const rows = await request("turmas", { method: "POST", body: JSON.stringify(input) });
  return rows[0];
}
async function updateTurma(idValue, input) {
  const rows = await request("turmas", { method: "PATCH", body: JSON.stringify(input) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteTurma(idValue) {
  await request("turmas", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function listTurmaHorarios(turmaId) {
  return request("turma_horarios", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&order=dia_semana.asc,hora_inicio.asc`);
}
async function replaceTurmaHorarios(turmaId, items) {
  await request("turma_horarios", { method: "DELETE" }, `?turma_id=eq.${encodeURIComponent(turmaId)}`);
  if (!items.length) return [];
  return request("turma_horarios", { method: "POST", body: JSON.stringify(items.map((item) => ({ ...item, turma_id: turmaId }))) });
}
async function listReservasForTurmaData(turmaId, data) {
  return request("turma_reservas", {}, `?select=*&turma_id=eq.${encodeURIComponent(turmaId)}&data=eq.${encodeURIComponent(data)}&status=eq.confirmada`);
}
async function getReserva(idValue) {
  const rows = await request("turma_reservas", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function listMinhasReservas(alunoId) {
  const hoje = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return request("turma_reservas", {}, `?select=*&aluno_id=eq.${encodeURIComponent(alunoId)}&status=eq.confirmada&data=gte.${encodeURIComponent(hoje)}&order=data.asc`);
}
async function getVagasDisponiveis(turmaId, data) {
  const turma = await getTurma(turmaId);
  if (!turma) throw new Error("Turma n\xE3o encontrada.");
  const reservas = await listReservasForTurmaData(turmaId, data);
  return { limite: turma.limite_vagas, ocupadas: reservas.length, disponiveis: Math.max(0, turma.limite_vagas - reservas.length) };
}
async function reservarVaga(input) {
  return rpc("reservar_vaga_turma", {
    p_turma_id: input.turmaId,
    p_aluno_id: input.alunoId,
    p_organization_id: input.organizationId,
    p_data: input.data
  });
}
async function cancelarReserva(idValue, alunoId) {
  const rows = await request("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}&aluno_id=eq.${encodeURIComponent(alunoId)}`);
  if (!rows[0]) throw new Error("Reserva n\xE3o encontrada.");
  return rows[0];
}
async function cancelarReservaStaff(idValue) {
  const rows = await request("turma_reservas", { method: "PATCH", body: JSON.stringify({ status: "cancelada" }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Reserva n\xE3o encontrada.");
  return rows[0];
}
var DIAS_LEAD_SEM_CONTATO = 3;
async function listLeadsForOrganization(organizationId) {
  return request("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc`);
}
async function getLead(idValue) {
  const rows = await request("leads", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function createLead(input) {
  const rows = await request("leads", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId || void 0, nome: input.nome, telefone: input.telefone || void 0, email: input.email || void 0, origem: input.origem || void 0, interesse: input.interesse || void 0, responsavel_id: input.responsavelId || void 0, notas: input.notas || void 0, criado_por: input.criadoPor || void 0 }) });
  return rows[0];
}
async function updateLead(idValue, data) {
  const rows = await request("leads", { method: "PATCH", body: JSON.stringify({ nome: data.nome, telefone: data.telefone, email: data.email, origem: data.origem, interesse: data.interesse, unit_id: data.unitId, responsavel_id: data.responsavelId, notas: data.notas }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead n\xE3o encontrado.");
  return rows[0];
}
async function deleteLead(idValue) {
  await request("leads", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { success: true };
}
async function closeOpenFollowUps(leadId) {
  await request("lead_atividades", { method: "PATCH", body: JSON.stringify({ status: "concluida" }) }, `?lead_id=eq.${encodeURIComponent(leadId)}&tipo=eq.follow_up_automatico&status=eq.aberta`);
}
async function moverEstagioLead(idValue, estagio) {
  const rows = await request("leads", { method: "PATCH", body: JSON.stringify({ estagio }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  if (!rows[0]) throw new Error("Lead n\xE3o encontrado.");
  await closeOpenFollowUps(idValue);
  return rows[0];
}
async function marcarLeadPerdido(idValue, motivoPerda) {
  const rows = await request("leads", { method: "PATCH", body: JSON.stringify({ estagio: "perdido", motivo_perda: motivoPerda }) }, `?id=eq.${encodeURIComponent(idValue)}`);
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
  const rows = await request("leads", { method: "PATCH", body: JSON.stringify({ estagio: "convite_enviado", member_invitation_id: invitation.id }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  await closeOpenFollowUps(idValue);
  return { lead: rows[0], invitation };
}
async function listLeadAtividades(leadId) {
  return request("lead_atividades", {}, `?select=*&lead_id=eq.${encodeURIComponent(leadId)}&order=created_at.desc`);
}
async function createLeadNota(input) {
  const rows = await request("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: input.leadId, organization_id: input.organizationId, tipo: "nota", status: "concluida", descricao: input.descricao, criado_por: input.criadoPor, responsavel_id: input.responsavelId || void 0 }) });
  await closeOpenFollowUps(input.leadId);
  return rows[0];
}
async function listLeadsSemContato(dias = DIAS_LEAD_SEM_CONTATO) {
  const cutoff = new Date(Date.now() - dias * 24 * 60 * 60 * 1e3).toISOString();
  const candidatos = await request("leads", {}, `?select=id,organization_id,created_at&estagio=not.in.(matriculado,perdido)&created_at=lt.${encodeURIComponent(cutoff)}`);
  if (!candidatos.length) return [];
  const ids = candidatos.map((c) => c.id).join(",");
  const atividades = await request("lead_atividades", {}, `?select=lead_id,created_at&lead_id=in.(${ids})&order=created_at.desc`);
  const ultimaAtividade = /* @__PURE__ */ new Map();
  for (const atividade of atividades) if (!ultimaAtividade.has(atividade.lead_id)) ultimaAtividade.set(atividade.lead_id, atividade.created_at);
  return candidatos.filter((lead) => (ultimaAtividade.get(lead.id) ?? lead.created_at) < cutoff);
}
async function createFollowUpLeadIfNeeded(leadId, organizationId, dias) {
  try {
    return await request("lead_atividades", { method: "POST", body: JSON.stringify({ lead_id: leadId, organization_id: organizationId, tipo: "follow_up_automatico", status: "aberta", descricao: `Sem contato registrado h\xE1 mais de ${dias} dias.` }) }).then((rows) => rows[0]);
  } catch {
    return null;
  }
}
var FOLLOW_UP_ATRASADO_HORAS = 48;
async function getCrmIndicadores(organizationId, unitId) {
  const filtroUnidade = unitId ? `&unit_id=eq.${encodeURIComponent(unitId)}` : "";
  const trintaDiasAtras = new Date(Date.now() - 1e3 * 60 * 60 * 24 * 30).toISOString();
  const [leads, atividadesOrg] = await Promise.all([
    request("leads", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${filtroUnidade}`),
    request("lead_atividades", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.asc`)
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
async function rpc(fn, args) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!response.ok) {
    const body = await response.text();
    let message;
    try {
      message = JSON.parse(body).message;
    } catch {
    }
    throw new Error(message || `Supabase RPC ${fn} ${response.status}: ${body}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function getCurrentPrivacyPolicy() {
  const rows = await request("privacy_policy_versions", {}, "?select=*&order=effective_at.desc&limit=1");
  return rows[0] ?? null;
}
async function hasConsent(userId, consentType) {
  const rows = await request("user_consents", {}, `?select=id&user_id=eq.${encodeURIComponent(userId)}&consent_type=eq.${consentType}&granted=eq.true&limit=1`);
  return rows.length > 0;
}
async function recordConsent(input) {
  const rows = await request("user_consents", { method: "POST", body: JSON.stringify({ user_id: input.userId, consent_type: input.consentType, policy_version_id: input.policyVersionId ?? null, granted: true, ip_address: input.ipAddress ?? null, user_agent: input.userAgent ?? null }) });
  return rows[0];
}
async function createDeletionRequest(input) {
  const existing = await request("data_deletion_requests", {}, `?select=id&user_id=eq.${encodeURIComponent(input.userId)}&status=eq.pending&limit=1`);
  if (existing.length) throw new Error("Voc\xEA j\xE1 tem uma solicita\xE7\xE3o de exclus\xE3o pendente.");
  const rows = await request("data_deletion_requests", { method: "POST", body: JSON.stringify({ user_id: input.userId, organization_id: input.organizationId, reason: input.reason || void 0 }) });
  return rows[0];
}
async function getMyDeletionRequest(userId) {
  const rows = await request("data_deletion_requests", {}, `?select=*&user_id=eq.${encodeURIComponent(userId)}&order=requested_at.desc&limit=1`);
  return rows[0] ?? null;
}
async function getDeletionRequest(idValue) {
  const rows = await request("data_deletion_requests", {}, `?select=*&id=eq.${encodeURIComponent(idValue)}&limit=1`);
  return rows[0] ?? null;
}
async function listDeletionRequests(organizationId, status) {
  return request("data_deletion_requests", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}${status ? `&status=eq.${status}` : ""}&order=requested_at.asc`);
}
async function fulfillDeletionRequest(input) {
  await rpc("delete_member_data", { p_aluno_id: input.alunoId, p_resolved_by: input.resolvedBy, p_request_id: input.requestId, p_note: input.note || null });
  return { requestId: input.requestId, status: "completed" };
}
async function rejectDeletionRequest(input) {
  const rows = await request("data_deletion_requests", { method: "PATCH", body: JSON.stringify({ status: "rejected", resolved_at: (/* @__PURE__ */ new Date()).toISOString(), resolved_by: input.resolvedBy, resolution_note: input.note || null }) }, `?id=eq.${encodeURIComponent(input.requestId)}&organization_id=eq.${encodeURIComponent(input.organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Solicita\xE7\xE3o n\xE3o encontrada ou j\xE1 resolvida.");
  return rows[0];
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
async function rpc2(fn, args) {
  const { url, key } = config2();
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
  const rows = await request2(
    "saas_memberships",
    {},
    `?select=*,saas_organizations(*)&auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.active`
  );
  return rows.map(({ saas_organizations, ...membership }) => ({ membership, organization: saas_organizations })).sort((a, b) => b.organization.updated_at.localeCompare(a.organization.updated_at));
}
var MEMBERSHIP_ROLE_TITLE = { owner: "Dono(a)", admin: "Administrador", manager: "Gerente", professional: "Profissional de treino", nutricionista: "Nutricionista", viewer: "Visualizador" };
async function resolveOrgLoginProfile(authUserId, fallbackName) {
  const memberships = await getOrganizationsForUser(authUserId);
  if (memberships.length > 0) {
    const primary = memberships[0];
    return { module: "profissional", role: MEMBERSHIP_ROLE_TITLE[primary.membership.role] ?? "Equipe", workspace: primary.organization.name, name: fallbackName, logoUrl: primary.organization.logo_url };
  }
  const aluno = await findAlunoByAuthUserId(authUserId);
  if (aluno) {
    const organization = await getOrganization(aluno.organization_id);
    return { module: "aluno", role: "Aluno", workspace: organization?.name ?? fallbackName, name: aluno.nome || fallbackName, logoUrl: organization?.logo_url ?? null };
  }
  return null;
}
async function getMembership(userId, organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request2(
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
  const rows = await request2("saas_memberships", {}, `?select=auth_user_id&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&role=in.(${rolesFilter})`);
  return rows.map((row) => row.auth_user_id);
}
async function getOrganizationBySlug(slug) {
  if (!isConfigured()) return void 0;
  const rows = await request2("saas_organizations", {}, `?select=id,name,slug,module,logo_url,primary_color&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0];
}
async function createOrganizationWithOwner(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc2("create_organization_with_owner", {
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
var TEAM_ROLE_LABEL = { admin: "Administrador", manager: "Gerente", professional: "Profissional de treino", nutricionista: "Nutricionista", viewer: "Visualizador" };
async function createOrganizationInvitation(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request2("saas_invitations", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, invited_by_user_id: input.invitedByUserId, email: input.email, full_name: input.fullName, role: input.role, token_hash: input.tokenHash, expires_at: input.expiresAt.toISOString() }) });
  const organization = await getOrganization(input.organizationId);
  const orgName = organization?.name ?? "sua organiza\xE7\xE3o";
  await sendEmail(input.email, `Convite para a equipe de ${orgName} no Arke`, `<p>Ol\xE1, ${input.fullName}.</p><p>Voc\xEA foi convidado(a) para fazer parte da equipe de <strong>${orgName}</strong> no Arke, com o papel de <strong>${TEAM_ROLE_LABEL[input.role]}</strong>.</p><p>Para aceitar, acesse o portal, clique em "Tenho um convite de equipe" na tela de login, crie sua senha e use o c\xF3digo abaixo:</p><h2 style="letter-spacing:1px">${input.rawToken}</h2><p>Este convite expira em 72 horas.</p>`);
  return created;
}
async function findOrganizationInvitationByTokenHash(tokenHash) {
  if (!isConfigured()) return null;
  const rows = await request2("saas_invitations", {}, `?select=*&token_hash=eq.${encodeURIComponent(tokenHash)}&status=eq.pending&limit=1`);
  return rows[0] ?? null;
}
async function acceptOrganizationInvitationSignup(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const tokenHash = createHash2("sha256").update(input.token).digest("hex");
  const invitation = await findOrganizationInvitationByTokenHash(tokenHash);
  if (!invitation) throw new Error("C\xF3digo de convite inv\xE1lido ou j\xE1 utilizado.");
  if (new Date(invitation.expires_at).getTime() < Date.now()) throw new Error("Este convite expirou. Pe\xE7a para reenviarem o convite.");
  const authUser = await createSupabaseUserWithPassword(invitation.email, input.password, invitation.full_name);
  const [result] = await rpc2("accept_organization_invitation", {
    p_token_hash: tokenHash,
    p_user_id: authUser.id,
    p_email: invitation.email
  });
  if (!result) throw new Error("Convite n\xE3o encontrado ou j\xE1 utilizado.");
  const session = await signInWithSupabase(invitation.email, input.password);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user, organizationId: result.org_id, role: result.role, fullName: invitation.full_name, invitationId: result.invitation_id };
}
async function getPendingOrganizationInvitations(organizationId) {
  if (!isConfigured()) return [];
  return request2("saas_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}
async function revokeOrganizationInvitation(id2, organizationId) {
  if (!isConfigured()) throw new Error("Database not available");
  const rows = await request2("saas_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id2)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite n\xE3o encontrado ou j\xE1 utilizado.");
  return rows[0];
}
async function acceptOrganizationInvitation(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc2("accept_organization_invitation", {
    p_token_hash: input.tokenHash,
    p_user_id: input.userId,
    p_email: input.email
  });
  if (!result) throw new Error("Invitation not found or already used");
  return { invitation: { id: result.invitation_id }, organizationId: result.org_id, role: result.role };
}
async function getOrganizationSubscription(organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request2("saas_subscriptions", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=1`);
  return rows[0];
}
async function listPlatformAppointments(input = {}) {
  if (!isConfigured()) return [];
  const filters = [input.desde ? `&scheduled_at=gte.${encodeURIComponent(input.desde)}` : "", input.ate ? `&scheduled_at=lte.${encodeURIComponent(input.ate)}` : ""].join("");
  return request2("arke_internal_appointments", {}, `?select=*&order=scheduled_at.asc${filters}`);
}
async function createPlatformAppointment(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [row] = await request2("arke_internal_appointments", { method: "POST", body: JSON.stringify({ staff_user_id: input.staffUserId, organization_id: input.organizationId ?? null, tipo: input.tipo, titulo: input.titulo, descricao: input.descricao ?? null, scheduled_at: input.scheduledAt, duracao_minutos: input.duracaoMinutos, criado_por: input.criadoPor }) });
  return row;
}
async function updatePlatformAppointment(id2, input) {
  if (!isConfigured()) throw new Error("Database not available");
  const body = {};
  if (input.titulo !== void 0) body.titulo = input.titulo;
  if (input.descricao !== void 0) body.descricao = input.descricao;
  if (input.scheduledAt !== void 0) body.scheduled_at = input.scheduledAt;
  if (input.duracaoMinutos !== void 0) body.duracao_minutos = input.duracaoMinutos;
  if (input.status !== void 0) body.status = input.status;
  if (input.tipo !== void 0) body.tipo = input.tipo;
  if (input.organizationId !== void 0) body.organization_id = input.organizationId;
  const [row] = await request2("arke_internal_appointments", { method: "PATCH", body: JSON.stringify(body) }, `?id=eq.${encodeURIComponent(id2)}`);
  return row;
}
async function deletePlatformAppointment(id2) {
  if (!isConfigured()) throw new Error("Database not available");
  await request2("arke_internal_appointments", { method: "DELETE" }, `?id=eq.${encodeURIComponent(id2)}`);
  return { id: id2 };
}
async function listAllOrganizationsForPlatform() {
  if (!isConfigured()) return [];
  const [orgs, subs] = await Promise.all([
    request2("saas_organizations", {}, "?select=*&order=created_at.desc"),
    request2("saas_subscriptions", {}, "?select=*&order=created_at.desc")
  ]);
  const subByOrg = /* @__PURE__ */ new Map();
  for (const sub of subs) if (!subByOrg.has(sub.organization_id)) subByOrg.set(sub.organization_id, sub);
  return orgs.map((org) => ({ ...org, subscription: subByOrg.get(org.id) ?? null }));
}
async function updateOrganizationProfile(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [updated] = await request2("saas_organizations", { method: "PATCH", body: JSON.stringify({ name: input.name, ...input.logoUrl !== void 0 ? { logo_url: input.logoUrl } : {}, ...input.primaryColor !== void 0 ? { primary_color: input.primaryColor } : {} }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  return updated;
}
async function updateOrganizationSubscription(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const amountCents = PLAN_AMOUNTS_CENTS[input.plan];
  const limits = PLAN_LIMITS[input.plan];
  await request2("saas_organizations", { method: "PATCH", body: JSON.stringify({ plan: input.plan, max_units: limits.maxUnits, max_users: limits.maxUsers }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  await request2("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ plan: input.plan, amount_cents: amountCents, ...input.status ? { status: input.status } : {} }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
  return getOrganizationSubscription(input.organizationId);
}
async function getOrganization(organizationId) {
  const rows = await request2("saas_organizations", {}, `?select=*&id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0];
}
async function getOrCreateAsaasCustomerForOrganization(organizationId) {
  const organization = await getOrganization(organizationId);
  if (!organization) throw new Error("Organiza\xE7\xE3o n\xE3o encontrada.");
  if (organization.asaas_customer_id) return organization.asaas_customer_id;
  const [client] = await request2("app_users", {}, `?select=name,email&id=eq.${encodeURIComponent(organization.client_id)}&limit=1`);
  if (!client) throw new Error("Cliente respons\xE1vel pela organiza\xE7\xE3o n\xE3o encontrado.");
  const customer = await createAsaasCustomer({ name: organization.name, email: client.email });
  await request2("saas_organizations", { method: "PATCH", body: JSON.stringify({ asaas_customer_id: customer.id }) }, `?id=eq.${encodeURIComponent(organizationId)}`);
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
  await request2("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ provider: "asaas", external_id: payment.id }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
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
    await request2("saas_organizations", { method: "PATCH", body: JSON.stringify({ setup_fee_charged_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(organizationId)}`);
  } catch (error) {
    captureException2(error, { route: "onboarding.setupFee", organizationId });
  }
}
async function getOrganizationAccess(userId, organizationId) {
  if (!isConfigured()) return void 0;
  const membership = await getMembership(userId, organizationId);
  if (!membership) return void 0;
  const [units, policies] = await Promise.all([
    request2("saas_units", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request2("saas_module_policies", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}`)
  ]);
  return { organization: membership.organization, membership: membership.membership, units, policies };
}
async function saveOrganizationOnboarding(input) {
  if (!isConfigured()) throw new Error("Database not available");
  if (input.logoUrl !== void 0 || input.primaryColor !== void 0 || input.defaultUnitName !== void 0) {
    await request2("saas_organizations", { method: "PATCH", body: JSON.stringify({ ...input.logoUrl !== void 0 ? { logo_url: input.logoUrl } : {}, ...input.primaryColor !== void 0 ? { primary_color: input.primaryColor } : {}, ...input.defaultUnitName !== void 0 ? { name: input.defaultUnitName } : {} }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  }
  await request2("saas_onboarding", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, current_step: input.currentStep, status: input.status, city: input.city ?? null, default_unit_name: input.defaultUnitName ?? null, invite_email: input.inviteEmail ?? null }) }, "?on_conflict=organization_id");
  if (input.status === "completed") await chargeSetupFeeIfNeeded(input.organizationId);
  return { organizationId: input.organizationId, saved: true };
}
async function updateModulePolicy(input) {
  if (!isConfigured()) throw new Error("Database not available");
  await request2("saas_module_policies", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId, role: input.role, module: input.module, can_view: input.canView, can_manage: input.canManage }) }, "?on_conflict=organization_id,unit_id,role,module");
  return { saved: true };
}
async function getOrganizationOnboarding(organizationId) {
  if (!isConfigured()) return void 0;
  const rows = await request2("saas_onboarding", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0];
}
async function listOrganizationUnits(organizationId) {
  if (!isConfigured()) return [];
  return request2("saas_units", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active&order=name.asc`);
}
async function createOrganizationUnit(input) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request2("saas_units", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, name: input.name, slug: input.slug, city: input.city ?? null, status: "active" }) });
  return created;
}
async function archiveOrganizationUnit(organizationId, unitId) {
  if (!isConfigured()) throw new Error("Database not available");
  await request2("saas_units", { method: "PATCH", body: JSON.stringify({ status: "archived" }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(unitId)}`);
  return { organizationId, unitId, status: "archived" };
}
async function recordAuditLog(input) {
  if (!isConfigured()) return void 0;
  const [created] = await request2("saas_audit_logs", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, auth_user_id: input.userId, action: input.action, entity: input.entity, entity_id: input.entityId ?? null, before_json: input.beforeJson ?? null, after_json: input.afterJson ?? null }) });
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
  return request2("saas_audit_logs", {}, `?${params.toString()}`);
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

// server/importacao.ts
var cell = (row, ...keys) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== void 0 && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return void 0;
};
var DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
var slugify = (value) => value.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || `unidade-${Date.now()}`;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidCpf(raw) {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digits = cpf.split("").map(Number);
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += digits[i] * (len + 1 - i);
    const result = sum * 10 % 11;
    return result === 10 ? 0 : result;
  };
  return calc(9) === digits[9] && calc(10) === digits[10];
}
function parseDateBr(raw) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  let year, month, day;
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (br) {
    [, day, month, year] = br.map(Number);
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return date.toISOString().slice(0, 10);
}
function parseNumber(raw) {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    const parts = cleaned.split(".");
    normalized = parts.length > 2 ? parts.join("") : cleaned;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
function validateUnidades(rows) {
  const valid = [];
  const errors = [];
  const seenSlugs = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "unidade");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome da unidade \xE9 obrigat\xF3rio." });
    const slugBase = cell(row, "slug") ?? slugify(nome);
    let slug = slugBase;
    let attempt = 1;
    while (seenSlugs.has(slug)) slug = `${slugBase}-${++attempt}`;
    seenSlugs.add(slug);
    valid.push({ row: rowNumber, data: { name: nome, slug, city: cell(row, "cidade", "city") } });
  });
  return { valid, errors };
}
var PERIODICIDADES = /* @__PURE__ */ new Set(["mensal", "trimestral", "semestral", "anual"]);
function validatePlanos(rows, existentes) {
  const valid = [];
  const errors = [];
  const seenNomes = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "plano");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome do plano \xE9 obrigat\xF3rio." });
    const nomeKey = nome.toLowerCase();
    if (existentes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: `J\xE1 existe um plano chamado "${nome}" nesta organiza\xE7\xE3o.` });
    if (seenNomes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome de plano duplicado neste arquivo." });
    const valorRaw = cell(row, "valor_mensal", "valor");
    const valor = valorRaw ? parseNumber(valorRaw) : null;
    if (valor === null || valor < 0) return errors.push({ row: rowNumber, campo: "valor_mensal", motivo: "Valor mensal inv\xE1lido." });
    const periodicidadeRaw = (cell(row, "periodicidade") ?? "mensal").toLowerCase();
    if (!PERIODICIDADES.has(periodicidadeRaw)) return errors.push({ row: rowNumber, campo: "periodicidade", motivo: "Periodicidade deve ser mensal, trimestral, semestral ou anual." });
    seenNomes.add(nomeKey);
    valid.push({ row: rowNumber, data: { nome, valorMensal: valor, periodicidade: periodicidadeRaw } });
  });
  return { valid, errors };
}
async function validateAlunos(rows, organizationId) {
  const valid = [];
  const errors = [];
  const [existentesAlunos, planos, unidades] = await Promise.all([listAlunos(organizationId), listMembershipPlans(organizationId), listOrganizationUnits(organizationId)]);
  const cpfsExistentes = new Set(existentesAlunos.map((a) => a.cpf).filter(Boolean));
  const emailsExistentes = new Set(existentesAlunos.map((a) => a.email).filter(Boolean));
  const planoPorNome = new Map(planos.map((p) => [p.nome.toLowerCase(), p.id]));
  const unidadePorNome = new Map(unidades.map((u) => [u.name.toLowerCase(), u.id]));
  const seenCpfs = /* @__PURE__ */ new Set();
  const seenEmails = /* @__PURE__ */ new Set();
  const nomeDataExistentes = new Set(existentesAlunos.filter((a) => !a.cpf && !a.email).map((a) => `${a.nome.trim().toLowerCase()}|${a.data_nascimento ?? ""}`));
  const seenNomeData = /* @__PURE__ */ new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "aluno");
    if (!nome) {
      errors.push({ row: rowNumber, campo: "nome", motivo: "Nome \xE9 obrigat\xF3rio." });
      continue;
    }
    const cpfRaw = cell(row, "cpf");
    let cpf;
    if (cpfRaw) {
      if (!isValidCpf(cpfRaw)) {
        errors.push({ row: rowNumber, campo: "cpf", motivo: "CPF inv\xE1lido." });
        continue;
      }
      cpf = cpfRaw.replace(/\D/g, "");
      if (cpfsExistentes.has(cpf) || seenCpfs.has(cpf)) {
        errors.push({ row: rowNumber, campo: "cpf", motivo: "CPF j\xE1 cadastrado nesta organiza\xE7\xE3o." });
        continue;
      }
    }
    const emailRaw = cell(row, "email");
    let email;
    if (emailRaw) {
      if (!EMAIL_RE.test(emailRaw)) {
        errors.push({ row: rowNumber, campo: "email", motivo: "E-mail inv\xE1lido." });
        continue;
      }
      email = normalizeEmail(emailRaw);
      if (emailsExistentes.has(email) || seenEmails.has(email)) {
        errors.push({ row: rowNumber, campo: "email", motivo: "E-mail j\xE1 cadastrado nesta organiza\xE7\xE3o." });
        continue;
      }
    }
    const dataNascimentoRaw = cell(row, "data_nascimento", "nascimento");
    let dataNascimento;
    if (dataNascimentoRaw) {
      const parsed = parseDateBr(dataNascimentoRaw);
      if (!parsed) {
        errors.push({ row: rowNumber, campo: "data_nascimento", motivo: "Data de nascimento inv\xE1lida (use DD/MM/AAAA)." });
        continue;
      }
      dataNascimento = parsed;
    }
    const menorDeIdade = dataNascimento ? (/* @__PURE__ */ new Date()).getTime() - new Date(dataNascimento).getTime() < 1e3 * 60 * 60 * 24 * 365.25 * 18 : false;
    const responsavelNome = cell(row, "responsavel_nome", "responsavel");
    if (menorDeIdade && !responsavelNome) {
      errors.push({ row: rowNumber, campo: "responsavel_nome", motivo: "Aluno menor de idade precisa de respons\xE1vel." });
      continue;
    }
    const unidadeNome = cell(row, "unidade");
    let unitId;
    if (unidadeNome) {
      const found = unidadePorNome.get(unidadeNome.toLowerCase());
      if (!found) {
        errors.push({ row: rowNumber, campo: "unidade", motivo: `Unidade "${unidadeNome}" n\xE3o encontrada \u2014 cadastre a unidade antes de importar os alunos.` });
        continue;
      }
      unitId = found;
    }
    const planoNome = cell(row, "plano");
    let planoId;
    if (planoNome) {
      const found = planoPorNome.get(planoNome.toLowerCase());
      if (!found) {
        errors.push({ row: rowNumber, campo: "plano", motivo: `Plano "${planoNome}" n\xE3o encontrado \u2014 cadastre o plano antes de importar os alunos.` });
        continue;
      }
      planoId = found;
    }
    const valorMensalRaw = cell(row, "valor_mensal");
    const valorMensal = valorMensalRaw ? parseNumber(valorMensalRaw) ?? void 0 : void 0;
    if (valorMensalRaw && valorMensal === void 0) {
      errors.push({ row: rowNumber, campo: "valor_mensal", motivo: "Valor mensal inv\xE1lido." });
      continue;
    }
    const diaVencimentoRaw = cell(row, "dia_vencimento");
    let diaVencimento;
    if (diaVencimentoRaw) {
      const parsed = Number(diaVencimentoRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
        errors.push({ row: rowNumber, campo: "dia_vencimento", motivo: "Dia de vencimento deve ser entre 1 e 31." });
        continue;
      }
      diaVencimento = parsed;
    }
    if (cpf) seenCpfs.add(cpf);
    if (email) seenEmails.add(email);
    if (!cpf && !email) {
      const nomeDataKey = `${nome.trim().toLowerCase()}|${dataNascimento ?? ""}`;
      if (nomeDataExistentes.has(nomeDataKey) || seenNomeData.has(nomeDataKey)) {
        errors.push({ row: rowNumber, campo: "nome", motivo: "Aluno com este nome (e data de nascimento) j\xE1 cadastrado \u2014 sem CPF/e-mail para confirmar que \xE9 outra pessoa." });
        continue;
      }
      seenNomeData.add(nomeDataKey);
    }
    valid.push({ row: rowNumber, data: {
      organizationId,
      unitId,
      nome,
      cpf,
      email,
      telefone: cell(row, "telefone"),
      dataNascimento,
      responsavelNome,
      responsavelCpf: cell(row, "responsavel_cpf"),
      planoId,
      valorMensal,
      diaVencimento,
      origem: "importado"
    } });
  }
  return { valid, errors };
}
async function validateLeads(rows, organizationId) {
  const valid = [];
  const errors = [];
  const existentes = await listLeadsForOrganization(organizationId);
  const emailsExistentes = new Set(existentes.map((l) => l.email).filter(Boolean).map((e) => normalizeEmail(e)));
  const telefonesExistentes = new Set(existentes.map((l) => l.telefone?.replace(/\D/g, "")).filter(Boolean));
  const seenEmails = /* @__PURE__ */ new Set();
  const seenTelefones = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome \xE9 obrigat\xF3rio." });
    const emailRaw = cell(row, "email");
    if (emailRaw && !EMAIL_RE.test(emailRaw)) return errors.push({ row: rowNumber, campo: "email", motivo: "E-mail inv\xE1lido." });
    const email = emailRaw ? normalizeEmail(emailRaw) : void 0;
    const telefoneRaw = cell(row, "telefone");
    const telefone = telefoneRaw?.replace(/\D/g, "");
    if (!email && !telefone) return errors.push({ row: rowNumber, campo: "telefone", motivo: "Informe e-mail ou telefone." });
    if (email && (emailsExistentes.has(email) || seenEmails.has(email))) return errors.push({ row: rowNumber, campo: "email", motivo: "J\xE1 existe um lead com este e-mail nesta organiza\xE7\xE3o." });
    if (!email && telefone && (telefonesExistentes.has(telefone) || seenTelefones.has(telefone))) return errors.push({ row: rowNumber, campo: "telefone", motivo: "J\xE1 existe um lead com este telefone nesta organiza\xE7\xE3o." });
    if (email) seenEmails.add(email);
    if (telefone) seenTelefones.add(telefone);
    valid.push({ row: rowNumber, data: { organizationId, nome, telefone: telefoneRaw, email: emailRaw, origem: cell(row, "origem"), interesse: cell(row, "interesse"), notas: cell(row, "notas") } });
  });
  return { valid, errors };
}
function validateTurmas(rows, organizationId, existentes) {
  const valid = [];
  const errors = [];
  const seenNomes = /* @__PURE__ */ new Set();
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const nome = cell(row, "nome", "turma");
    if (!nome) return errors.push({ row: rowNumber, campo: "nome", motivo: "Nome da turma \xE9 obrigat\xF3rio." });
    const nomeKey = nome.toLowerCase();
    if (existentes.has(nomeKey) || seenNomes.has(nomeKey)) return errors.push({ row: rowNumber, campo: "nome", motivo: `J\xE1 existe uma turma chamada "${nome}".` });
    const limiteRaw = cell(row, "limite_vagas", "vagas");
    const limite = limiteRaw ? Number(limiteRaw) : null;
    if (!limite || !Number.isInteger(limite) || limite < 1) return errors.push({ row: rowNumber, campo: "limite_vagas", motivo: "Limite de vagas deve ser um n\xFAmero inteiro maior que zero." });
    const duracaoRaw = cell(row, "duracao_min");
    const duracao = duracaoRaw ? Number(duracaoRaw) : 60;
    if (!Number.isInteger(duracao) || duracao < 15 || duracao > 480) return errors.push({ row: rowNumber, campo: "duracao_min", motivo: "Dura\xE7\xE3o deve ser entre 15 e 480 minutos." });
    seenNomes.add(nomeKey);
    valid.push({ row: rowNumber, data: { organization_id: organizationId, nome, descricao: cell(row, "descricao"), limite_vagas: limite, duracao_min: duracao } });
  });
  return { valid, errors };
}
async function previewImport(entity, rows, organizationId) {
  const result = await runValidation(entity, rows, organizationId);
  return { validRows: result.valid.length, errorRows: result.errors.length, errors: result.errors.slice(0, 200), amostra: result.valid.slice(0, 20).map((v) => v.data) };
}
var COMMIT_CONCURRENCY = 10;
async function commitImport(entity, rows, organizationId, actorUserId) {
  const result = await runValidation(entity, rows, organizationId);
  let inserted = 0;
  const insertOne = async (item) => {
    try {
      switch (entity) {
        case "unidades": {
          const data = item.data;
          await createOrganizationUnit({ organizationId, name: data.name, slug: data.slug, city: data.city });
          break;
        }
        case "planos": {
          const data = item.data;
          await createMembershipPlan({ organizationId, nome: data.nome, valorMensal: data.valorMensal, periodicidade: data.periodicidade });
          break;
        }
        case "alunos": {
          const data = item.data;
          await createAluno({ ...data, criadoPor: actorUserId });
          break;
        }
        case "leads": {
          const data = item.data;
          await createLead({ ...data, criadoPor: actorUserId });
          break;
        }
        case "turmas": {
          const data = item.data;
          await createTurma({ ...data, criado_por: actorUserId });
          break;
        }
      }
      inserted++;
    } catch (error) {
      result.errors.push({ row: item.row, motivo: error instanceof Error ? error.message : "Falha ao gravar esta linha." });
    }
  };
  for (let start = 0; start < result.valid.length; start += COMMIT_CONCURRENCY) {
    await Promise.all(result.valid.slice(start, start + COMMIT_CONCURRENCY).map(insertOne));
  }
  return { inserted, errors: result.errors };
}
async function runValidation(entity, rows, organizationId) {
  switch (entity) {
    case "unidades":
      return validateUnidades(rows);
    case "planos": {
      const existentes = new Set((await listMembershipPlans(organizationId)).map((p) => p.nome.toLowerCase()));
      return validatePlanos(rows, existentes);
    }
    case "alunos":
      return validateAlunos(rows, organizationId);
    case "leads":
      return validateLeads(rows, organizationId);
    case "turmas": {
      const existentes = new Set((await listTurmasForOrganization(organizationId)).map((t2) => t2.nome.toLowerCase()));
      return validateTurmas(rows, organizationId, existentes);
    }
  }
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

// server/arkeGamification.ts
function weekKeyFor(dateStr) {
  const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00.000Z`);
  const diffToMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr, days) {
  const d = /* @__PURE__ */ new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDiasStr(a, b) {
  const da = (/* @__PURE__ */ new Date(`${a}T00:00:00.000Z`)).getTime();
  const db = (/* @__PURE__ */ new Date(`${b}T00:00:00.000Z`)).getTime();
  return Math.round((da - db) / 864e5);
}
function getSemanasNoPeriodo(desde, ate) {
  const semanas = [];
  let cursor = weekKeyFor(desde);
  while (cursor <= ate) {
    semanas.push({ inicio: cursor, fim: addDaysStr(cursor, 6) });
    cursor = addDaysStr(cursor, 7);
  }
  return semanas;
}
function calcStreakBonus(weeklyHits, bonusTable) {
  let streak = 0;
  let maxStreak = 0;
  for (const hit of weeklyHits) {
    if (hit) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }
  let bonus = 0;
  for (let i = bonusTable.length - 1; i >= 0; i--) {
    if (maxStreak >= i + 2) {
      bonus = bonusTable[i];
      break;
    }
  }
  return bonus;
}
var MODALIDADES_RASTREADAS = ["nata\xE7\xE3o", "ciclismo", "corrida"];
async function calcAuto(alunoId, desafio) {
  const meta = desafio.meta_valor ?? 0;
  switch (desafio.tipo) {
    case "sem_doce": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.filter((d) => d.consumiu_doce).length, meta, isInverse: true };
    }
    case "sem_alcool": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.filter((d) => d.consumiu_alcool).length, meta, isInverse: true };
    }
    case "consumo_agua": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: dietas.reduce((soma, d) => soma + (d.agua_ml ?? 0), 0), meta, isInverse: false };
    }
    case "numero_treinos": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: treinos.length, meta, isInverse: false };
    }
    case "quilometros": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      return { valor: treinos.reduce((soma, t2) => soma + (t2.distancia_km ?? 0), 0), meta, isInverse: false };
    }
    case "modalidades": {
      const treinos = await listTreinoCalendarioPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      const tipos = /* @__PURE__ */ new Set();
      for (const treino of treinos) for (const tipo of treino.tipos) tipos.add(tipo);
      return { valor: tipos.size, meta, isInverse: false };
    }
    case "desempenho_dieta": {
      const dietas = await listDietaAdesaoPeriodo(alunoId, desafio.data_inicio, desafio.data_fim);
      const media = dietas.length ? dietas.reduce((soma, d) => soma + d.adesao_percentual, 0) / dietas.length : 0;
      return { valor: Math.round(media), meta, isInverse: false };
    }
    default:
      return null;
  }
}
async function pontosDesafios(alunoId, organizationId, desde, ate, hoje) {
  const [desafiosOrg, participacoes, progresso] = await Promise.all([
    listDesafios(organizationId),
    listDesafioParticipantesForAluno(alunoId),
    listDesafioProgressoForAluno(alunoId)
  ]);
  const participandoIds = new Set(participacoes.map((p) => p.desafio_id));
  const progressoByDesafio = new Map(progresso.map((dp) => [dp.desafio_id, dp]));
  const aplicaveis = desafiosOrg.filter((d) => d.para_todos || participandoIds.has(d.id));
  const noPeriodo = aplicaveis.filter((d) => d.data_fim >= desde && d.data_fim <= ate);
  const pontosPorDesafio = await Promise.all(noPeriodo.map(async (desafio) => {
    const manual = progressoByDesafio.get(desafio.id);
    if (manual?.origem === "manual") return manual.concluido ? desafio.pontos : 0;
    const auto = await calcAuto(alunoId, desafio);
    if (!auto) return 0;
    const encerrado = desafio.data_fim < hoje;
    const concluido = auto.isInverse ? auto.valor <= auto.meta && encerrado : auto.meta > 0 && auto.valor >= auto.meta;
    return concluido ? desafio.pontos : 0;
  }));
  return Math.min(pontosPorDesafio.reduce((soma, pontos) => soma + pontos, 0), 20);
}
async function computeScoreAluno(alunoId, organizationId, desde, ate) {
  const semanas = getSemanasNoPeriodo(desde, ate);
  const hoje = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const [
    checkins,
    avaliacoes,
    objetivosRow,
    valoresRow,
    compromissoMetas,
    feedPosts,
    feedLikes,
    feedComments,
    dietaAdesao,
    treinos,
    alunoPerfil,
    progressosPeriodo,
    desafiosTotal
  ] = await Promise.all([
    listCheckinsPeriodo(alunoId, desde, ate),
    listAvaliacoesSemanaisPeriodo(alunoId, desde, ate),
    getAlunoObjetivosRecente(alunoId),
    getAlunoValoresRecente(alunoId),
    listCompromissoMetasPeriodo(alunoId, desde, ate),
    listFeedPostsPeriodoAluno(alunoId, desde, ate),
    listFeedLikesPeriodoAluno(alunoId, desde, ate),
    listFeedCommentsPeriodoAluno(alunoId, desde, ate),
    listDietaAdesaoPeriodo(alunoId, desde, ate),
    listTreinoCalendarioPeriodo(alunoId, desde, ate),
    getAlunoPerfil(alunoId),
    listProgressoSemanalPeriodo(alunoId, desde, ate),
    pontosDesafios(alunoId, organizationId, desde, ate, hoje)
  ]);
  const diasPreenchidos = Math.min(checkins.length, 15);
  let maxConsecDias = 0;
  let streakAtual = 0;
  const datasOrdenadas = checkins.map((c) => c.data).sort();
  datasOrdenadas.forEach((data, i) => {
    streakAtual = i === 0 ? 1 : diffDiasStr(data, datasOrdenadas[i - 1]) === 1 ? streakAtual + 1 : 1;
    maxConsecDias = Math.max(maxConsecDias, streakAtual);
  });
  const dedicacaoBonus = Math.min(Math.floor(maxConsecDias / 2), 10);
  const dedicacaoDiaria = { base: diasPreenchidos, bonus: dedicacaoBonus, total: Math.min(diasPreenchidos + dedicacaoBonus, 25), max: 25 };
  const weeklyAvaliacao = semanas.map((w) => avaliacoes.some((a) => a.semana === w.inicio));
  const progressoBase = Math.min(weeklyAvaliacao.filter(Boolean).length * 3, 12);
  const progressoBonus = calcStreakBonus(weeklyAvaliacao, [1, 2, 3]);
  const progressoSemanal = { base: progressoBase / 3, bonus: progressoBonus, total: Math.min(progressoBase + progressoBonus, 15), max: 15 };
  let objetivosTotal = 0;
  if (objetivosRow) {
    const valido = !objetivosRow.proxima_revisao || objetivosRow.proxima_revisao >= desde;
    if (valido) {
      const count = objetivosRow.objetivos.filter((o) => o?.trim()).length;
      objetivosTotal = count >= 3 ? 10 : count === 2 ? 7 : count === 1 ? 4 : 0;
    }
  }
  let valoresTotal = 0;
  if (valoresRow && valoresRow.valores.length >= 3) {
    const valido = !valoresRow.validade || valoresRow.validade >= desde;
    if (valido) valoresTotal = 10;
  }
  const weeklyCompromissoCount = semanas.map((w) => Math.min(compromissoMetas.filter((m) => m.compromisso_semanal.semana === w.inicio).length, 3));
  const compromissosBase = Math.min(weeklyCompromissoCount.reduce((soma, v) => soma + v, 0), 12);
  const weeklyCompHit = weeklyCompromissoCount.map((v) => v > 0);
  let compStreak = 0;
  let compMaxStreak = 0;
  for (const hit of weeklyCompHit) {
    if (hit) {
      compStreak++;
      compMaxStreak = Math.max(compMaxStreak, compStreak);
    } else compStreak = 0;
  }
  const compBonus = compMaxStreak >= 6 ? 3 : compMaxStreak >= 4 ? 2 : compMaxStreak >= 2 ? 1 : 0;
  const compromissosCriados = { base: compromissosBase, bonus: compBonus, total: Math.min(compromissosBase + compBonus, 15), max: 15 };
  const feedWeekly = semanas.map((w) => {
    const naSemana = (createdAt) => {
      const dia = createdAt.slice(0, 10);
      return dia >= w.inicio && dia <= w.fim;
    };
    return feedPosts.some((p) => naSemana(p.created_at)) || feedLikes.some((l) => naSemana(l.created_at)) || feedComments.some((c) => naSemana(c.created_at));
  });
  const feedTotal = Math.min(feedWeekly.filter(Boolean).length, 5);
  let calendarioDietaTotal = 0;
  for (const dieta of dietaAdesao) calendarioDietaTotal += diffDiasStr(dieta.created_at.slice(0, 10), dieta.data) === 0 ? 1 : 0.5;
  calendarioDietaTotal = Math.min(Math.floor(calendarioDietaTotal), 20);
  const engajamentoTotal = Math.min(dedicacaoDiaria.total + progressoSemanal.total + objetivosTotal + valoresTotal + compromissosCriados.total + feedTotal + calendarioDietaTotal, 100);
  const metaSemanal = alunoPerfil?.meta_semanal_dias ?? 3;
  const weeklyTreinoHit = semanas.map((w) => treinos.filter((t2) => t2.data >= w.inicio && t2.data <= w.fim).length >= metaSemanal);
  const treinoBase = Math.min(weeklyTreinoHit.filter(Boolean).length * 3, 12);
  const treinoBonus = calcStreakBonus(weeklyTreinoHit, [1, 2, 3]);
  const metaTreino = { base: treinoBase / 3, bonus: treinoBonus, total: Math.min(treinoBase + treinoBonus, 15), max: 15 };
  const modalidadesSet = /* @__PURE__ */ new Set();
  for (const treino of treinos) for (const tipo of treino.tipos) {
    const lower = tipo.toLowerCase();
    if (MODALIDADES_RASTREADAS.includes(lower)) modalidadesSet.add(lower);
  }
  const modalidadesCount = modalidadesSet.size;
  const modalidadesTotal = modalidadesCount >= 3 ? 5 : modalidadesCount === 2 ? 3 : modalidadesCount === 1 ? 2 : 0;
  const weeklyDietaHit = semanas.map((w) => {
    const semanaDieta = dietaAdesao.filter((d) => d.data >= w.inicio && d.data <= w.fim);
    if (!semanaDieta.length) return false;
    return semanaDieta.reduce((soma, d) => soma + d.adesao_percentual, 0) / semanaDieta.length >= 80;
  });
  const dietaBase = Math.min(weeklyDietaHit.filter(Boolean).length * 3, 12);
  const dietaBonus = calcStreakBonus(weeklyDietaHit, [1, 2, 3]);
  const dietaSemanal = { base: dietaBase / 3, bonus: dietaBonus, total: Math.min(dietaBase + dietaBonus, 15), max: 15 };
  let metasNaoAtingidas = 0;
  let metasBatidas = 0;
  if (progressosPeriodo.length > 0) {
    const latest = progressosPeriodo[0];
    const checkMeta = (atual, alvo, dir, tolerancia) => {
      if (atual == null || alvo == null || !dir) return;
      let atingida = false;
      if (dir === "diminuir") atingida = atual <= alvo;
      else if (dir === "aumentar") atingida = atual >= alvo;
      else if (dir === "manter") atingida = Math.abs(atual - alvo) <= tolerancia;
      if (atingida) metasBatidas++;
      else metasNaoAtingidas++;
    };
    checkMeta(latest.peso_kg, latest.meta_peso_kg, latest.meta, 1);
    checkMeta(latest.gordura_percentual, latest.meta_gordura_valor, latest.meta_gordura, 0.5);
    checkMeta(latest.musculo_percentual, latest.meta_musculo_valor, latest.meta_musculo, 0.5);
  }
  const metasMesTotal = metasNaoAtingidas === 1 ? 16 : metasNaoAtingidas === 2 ? 7 : metasNaoAtingidas >= 3 ? 0 : 25;
  const weeklyConquista = semanas.map((w) => avaliacoes.some((a) => a.semana === w.inicio && a.conquista?.trim()));
  const conquistaBase = Math.min(weeklyConquista.filter(Boolean).length * 2, 8);
  const conquistaBonus = calcStreakBonus(weeklyConquista, [1, 2]);
  const conquistaSemanal = { base: conquistaBase / 2, bonus: conquistaBonus, total: Math.min(conquistaBase + conquistaBonus, 10), max: 10 };
  const weeklyCompCumprido = semanas.map((w) => compromissoMetas.some((m) => m.compromisso_semanal.semana === w.inicio && m.concluida));
  const compCumpridoBase = Math.min(weeklyCompCumprido.filter(Boolean).length * 2, 8);
  const compCumpridoBonus = calcStreakBonus(weeklyCompCumprido, [1, 2]);
  const compromissoCumprido = { base: compCumpridoBase / 2, bonus: compCumpridoBonus, total: Math.min(compCumpridoBase + compCumpridoBonus, 10), max: 10 };
  const weeklyAgua = semanas.map((w) => {
    const semanaDieta = dietaAdesao.filter((d) => d.data >= w.inicio && d.data <= w.fim);
    if (!semanaDieta.length) return false;
    return semanaDieta.reduce((soma, d) => soma + (d.agua_ml ?? 0), 0) / semanaDieta.length >= 1500;
  });
  const aguaBase = Math.min(weeklyAgua.filter(Boolean).length, 4);
  const aguaBonus = weeklyAgua.filter(Boolean).length >= 2 ? 1 : 0;
  const agua = { base: aguaBase, bonus: aguaBonus, total: Math.min(aguaBase + aguaBonus, 5), max: 5 };
  const diasAlcool = dietaAdesao.filter((d) => d.consumiu_alcool).length;
  const penalidadeTotal = diasAlcool * 5;
  const performanceTotal = Math.max(0, Math.min(metaTreino.total + dietaSemanal.total + metasMesTotal + conquistaSemanal.total + compromissoCumprido.total + agua.total + desafiosTotal + modalidadesTotal - penalidadeTotal, 100));
  return {
    engajamento: {
      dedicacaoDiaria,
      progressoSemanal,
      objetivos: { total: objetivosTotal, max: 10 },
      valores: { total: valoresTotal, max: 10 },
      compromissosCriados,
      feed: { total: feedTotal, max: 5 },
      calendarioDieta: { total: calendarioDietaTotal, max: 20 },
      total: engajamentoTotal
    },
    performance: {
      metaTreino,
      modalidades: { total: modalidadesTotal, count: modalidadesCount, max: 5 },
      dietaSemanal,
      metasMes: { total: metasMesTotal, metasBatidas, metasNaoAtingidas, max: 25 },
      conquistaSemanal,
      compromissoCumprido,
      agua,
      desafios: { total: desafiosTotal, max: 20 },
      penalidade: { total: penalidadeTotal, diasAlcool },
      total: performanceTotal
    },
    total: engajamentoTotal + performanceTotal
  };
}
async function computeComparativoAluno(alunoId, organizationId, desde, ate) {
  const alunoIds = await listAlunosComArkeAtivoIds(organizationId);
  const scores = await Promise.all(alunoIds.map((id2) => computeScoreAluno(id2, organizationId, desde, ate)));
  const tamanhoGrupo = alunoIds.length;
  const mediaGrupo = tamanhoGrupo ? scores.reduce((soma, score) => soma + score.total, 0) / tamanhoGrupo : 0;
  const indiceAluno = alunoIds.indexOf(alunoId);
  const minhaPontuacao = indiceAluno >= 0 ? scores[indiceAluno].total : (await computeScoreAluno(alunoId, organizationId, desde, ate)).total;
  return { minhaPontuacao, mediaGrupo, tamanhoGrupo };
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

// server/turnstileAdapters.ts
var genericAdapter = {
  buildTestConnectionCommand: () => ({ action: "test_connection", requestedAt: (/* @__PURE__ */ new Date()).toISOString() })
};
var adapters = {};
var TurnstileAdapterFactory = {
  forBrand(brand) {
    return adapters[brand] ?? genericAdapter;
  }
};

// server/turnstileRealtime.ts
function config3() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado.");
  return { url: url.replace(/\/$/, ""), key };
}
function turnstileChannel(deviceId) {
  return `turnstile:${deviceId}`;
}
async function publishTurnstileBroadcast(deviceId, event, payload) {
  const { url, key } = config3();
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: turnstileChannel(deviceId), event, payload }] })
  });
  if (!response.ok) throw new Error(`Supabase Realtime ${response.status}: ${await response.text()}`);
}

// server/integrations.ts
function config4() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado.");
  return { url: url.replace(/\/$/, ""), key };
}
async function request3(table, init2 = {}, query = "") {
  const { url, key } = config4();
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
var HEARTBEAT_STALE_MS = 5 * 60 * 1e3;
function computeStatus(lastPingAt) {
  if (!lastPingAt) return "unknown";
  return Date.now() - new Date(lastPingAt).getTime() <= HEARTBEAT_STALE_MS ? "online" : "offline";
}
function mapTurnstileRow(row) {
  return {
    id: row.id,
    unitId: row.unit_id,
    unitName: row.saas_units?.name ?? "Unidade",
    brand: row.brand,
    model: row.model,
    modelId: row.model_id,
    communicationMode: row.communication_mode,
    port: row.port,
    serialOrKey: row.serial_or_key,
    status: computeStatus(row.last_ping_at),
    lastPingAt: row.last_ping_at,
    enabled: row.enabled,
    configured: Object.keys(row.config ?? {}).length > 0,
    updatedAt: row.updated_at,
    lastTestRequestedAt: row.last_test_requested_at,
    lastTestAt: row.last_test_at,
    lastTestResult: row.last_test_result,
    lastTestMessage: row.last_test_message
  };
}
async function listTurnstileIntegrationsForOrganization(organizationId) {
  const rows = await request3("turnstile_devices", {}, `?select=*,saas_units(name)&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return rows.map(mapTurnstileRow);
}
async function saveTurnstileIntegration(input) {
  const unit = await request3("saas_units", {}, `?select=id&id=eq.${encodeURIComponent(input.unitId)}&organization_id=eq.${encodeURIComponent(input.organizationId)}&limit=1`);
  if (!unit[0]) throw new Error("Unidade n\xE3o encontrada nesta organiza\xE7\xE3o.");
  const existingRows = await request3("turnstile_devices", {}, `?select=config&unit_id=eq.${encodeURIComponent(input.unitId)}&organization_id=eq.${encodeURIComponent(input.organizationId)}&limit=1`);
  const mergedConfig = { ...existingRows[0]?.config ?? {} };
  for (const [key, value] of Object.entries(input.config)) if (value) mergedConfig[key] = value;
  await request3("turnstile_devices", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({
    unit_id: input.unitId,
    organization_id: input.organizationId,
    brand: input.brand,
    model: input.model || null,
    model_id: input.modelId || null,
    communication_mode: input.communicationMode || null,
    port: input.port ?? null,
    serial_or_key: input.serialOrKey || null,
    config: mergedConfig,
    enabled: input.enabled
  }) }, "?on_conflict=unit_id");
  const rows = await listTurnstileIntegrationsForOrganization(input.organizationId);
  return rows.find((row) => row.unitId === input.unitId);
}
async function deleteTurnstileIntegration(unitId, organizationId) {
  await request3("turnstile_devices", { method: "DELETE" }, `?unit_id=eq.${encodeURIComponent(unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}`);
  return { success: true };
}
async function requestTurnstileTestConnection(unitId, organizationId) {
  const rows = await request3("turnstile_devices", {}, `?select=*,saas_units(name)&unit_id=eq.${encodeURIComponent(unitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  const device = rows[0];
  if (!device) throw new Error("Catraca n\xE3o configurada para esta unidade.");
  const command = TurnstileAdapterFactory.forBrand(device.brand).buildTestConnectionCommand();
  await publishTurnstileBroadcast(device.id, "command", command);
  const requestedAt = (/* @__PURE__ */ new Date()).toISOString();
  await request3("turnstile_devices", { method: "PATCH", body: JSON.stringify({ last_test_requested_at: requestedAt }) }, `?id=eq.${encodeURIComponent(device.id)}`);
  return mapTurnstileRow({ ...device, last_test_requested_at: requestedAt });
}
async function getTurnstileDeviceById(deviceId) {
  const rows = await request3("turnstile_devices", {}, `?select=*,saas_units(name)&id=eq.${encodeURIComponent(deviceId)}&limit=1`);
  return rows[0] ?? null;
}
async function recordTurnstileHeartbeat(deviceId, organizationId) {
  const device = await getTurnstileDeviceById(deviceId);
  if (!device || device.organization_id !== organizationId) return { success: false };
  await request3("turnstile_devices", { method: "PATCH", body: JSON.stringify({ status: "online", last_ping_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(deviceId)}`);
  return { success: true };
}
async function reportTurnstileTestResult(deviceId, organizationId, result, message) {
  const device = await getTurnstileDeviceById(deviceId);
  if (!device || device.organization_id !== organizationId) return { success: false };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const patch = { last_test_at: now, last_test_result: result, last_test_message: message ?? null };
  if (result === "success") {
    patch.status = "online";
    patch.last_ping_at = now;
  }
  await request3("turnstile_devices", { method: "PATCH", body: JSON.stringify(patch) }, `?id=eq.${encodeURIComponent(deviceId)}`);
  return { success: true };
}
async function listTurnstileCatalog() {
  const [brands, models] = await Promise.all([
    request3("turnstile_brands", {}, "?select=*&order=name"),
    request3("turnstile_models", {}, "?select=*&order=name")
  ]);
  return brands.map((brand) => ({
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    models: models.filter((model) => model.brand_id === brand.id).map((model) => ({ id: model.id, name: model.name, communicationModes: model.communication_modes, defaultPort: model.default_port, protocolNotes: model.protocol_notes }))
  }));
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

// shared/turnstile.ts
var TURNSTILE_BRAND_KEYS = ["control_id", "topdata", "henry", "dimep", "intelbras", "zkteco", "nitgen", "hikvision", "madis", "primme", "nedap", "suprema", "outra"];

// server/routers.ts
var organizationIdInput = z2.object({ organizationId: z2.string().uuid() });
var periodoInput = z2.object({ desde: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
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
  if (!membership || membership.membership.status !== "active" || !["owner", "admin", "manager"].includes(membership.membership.role)) throw new Error("You do not have permission to manage this organization");
  return membership;
};
var hasOrganizationAccess = async (userId, organizationId) => {
  const membership = await getMembership(userId, organizationId);
  if (!membership || membership.membership.status !== "active") throw new Error("Organization access denied");
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
      const orgProfile = result.appUser ? null : await resolveOrgLoginProfile(result.user.id, String(result.user.user_metadata?.full_name ?? result.user.user_metadata?.name ?? result.user.email ?? ""));
      return { ...result, orgProfile };
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
      const orgProfile = appUser ? null : await resolveOrgLoginProfile(supabaseUser.id, String(supabaseUser.user_metadata?.full_name ?? supabaseUser.user_metadata?.name ?? supabaseUser.email ?? ""));
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, session.access_token, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return { accessToken: session.access_token, user: supabaseUser, appUser, orgProfile };
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
    // admin.users/lookupCnpj cadastram, editam e excluem clientes
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
    })
  }),
  // Painel de negócio ArkeFit (Sessão C do plano de Sept/2026): operação
  // interna da própria Metodos Arke — nunca uma tela de organização
  // cliente. Restrito a adminProcedure (mesmo allowlist de e-mail que já
  // protege admin.*/globalLibrary.*), com consultas cross-organização
  // (as primeiras do projeto sem filtro de organization_id — ver a nota em
  // listAllOrganizationsForPlatform em server/db.ts).
  plataforma: router({
    dashboard: adminProcedure.query(async () => {
      const [organizacoes, alunosArkeAtivos] = await Promise.all([listAllOrganizationsForPlatform(), countAllAlunosComArkeAtivo()]);
      const inicioMes = new Date(Date.UTC((/* @__PURE__ */ new Date()).getUTCFullYear(), (/* @__PURE__ */ new Date()).getUTCMonth(), 1)).toISOString();
      const porStatus = { trial: 0, active: 0, past_due: 0, canceled: 0 };
      let mrrCents = 0;
      let novasEsteMes = 0;
      let canceladasEsteMes = 0;
      for (const organizacao of organizacoes) {
        porStatus[organizacao.status] += 1;
        if (organizacao.subscription?.status === "active") mrrCents += organizacao.subscription.amount_cents;
        if (organizacao.created_at >= inicioMes) novasEsteMes += 1;
        if (organizacao.status === "canceled" && organizacao.updated_at >= inicioMes) canceladasEsteMes += 1;
      }
      return { totalOrganizacoes: organizacoes.length, porStatus, mrrCents, novasEsteMes, canceladasEsteMes, alunosArkeAtivos };
    }),
    // Financeiro ArkeFit: o que cada cliente deve à Arke (mensalidade,
    // módulo Arke, taxa de setup) — todos já são cobranças Asaas reais
    // persistidas em asaas_payments (createSubscriptionCharge,
    // runArkeRepasseMensal, chargeSetupFeeIfNeeded), nunca um valor
    // estimado. `status` aqui é o status bruto do Asaas (RECEIVED,
    // CONFIRMED, PENDING, OVERDUE...), não traduzido no servidor — o
    // cliente decide o rótulo em pt-BR.
    financeiro: adminProcedure.input(z2.object({ status: z2.string().trim().max(40).optional() }).optional()).query(async ({ input }) => {
      const [pagamentos, organizacoes] = await Promise.all([listAllAsaasPayments({ status: input?.status }), listAllOrganizationsForPlatform()]);
      const nomePorOrg = new Map(organizacoes.map((org) => [org.id, org.name]));
      let totalRecebidoReais = 0;
      let totalPendenteReais = 0;
      for (const pagamento of pagamentos) {
        const valor = Number(pagamento.value ?? 0);
        if (pagamento.status === "RECEIVED" || pagamento.status === "CONFIRMED") totalRecebidoReais += valor;
        else if (pagamento.status === "PENDING" || pagamento.status === "OVERDUE") totalPendenteReais += valor;
      }
      return {
        pagamentos: pagamentos.map((pagamento) => ({ ...pagamento, organizationName: pagamento.organization_id ? nomePorOrg.get(pagamento.organization_id) ?? null : null })),
        totalRecebidoReais,
        totalPendenteReais
      };
    }),
    // Agenda interna: implantação/onboarding e acompanhamento de clientes
    // pela própria equipe Arke — nunca visível a nenhuma organização
    // cliente (arke_internal_appointments, RLS sem política, só backend).
    agenda: router({
      list: adminProcedure.input(z2.object({ desde: z2.string().optional(), ate: z2.string().optional() }).optional()).query(({ input }) => listPlatformAppointments(input ?? {})),
      create: adminProcedure.input(z2.object({ organizationId: z2.string().uuid().optional(), tipo: z2.enum(["onboarding", "implantacao", "acompanhamento", "outro"]).default("outro"), titulo: z2.string().trim().min(2).max(200), descricao: z2.string().trim().max(2e3).optional(), scheduledAt: z2.string().datetime(), duracaoMinutos: z2.number().int().min(5).max(480).default(30) })).mutation(({ ctx, input }) => createPlatformAppointment({ organizationId: input.organizationId, tipo: input.tipo, titulo: input.titulo, descricao: input.descricao, scheduledAt: input.scheduledAt, duracaoMinutos: input.duracaoMinutos, staffUserId: ctx.user.id, criadoPor: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), organizationId: z2.string().uuid().optional(), tipo: z2.enum(["onboarding", "implantacao", "acompanhamento", "outro"]).optional(), titulo: z2.string().trim().min(2).max(200).optional(), descricao: z2.string().trim().max(2e3).optional(), scheduledAt: z2.string().datetime().optional(), duracaoMinutos: z2.number().int().min(5).max(480).optional(), status: z2.enum(["agendado", "concluido", "cancelado"]).optional() })).mutation(({ input }) => {
        const { id: id2, ...changes } = input;
        return updatePlatformAppointment(id2, changes);
      }),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deletePlatformAppointment(input.id))
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
      // Catálogo global marca→modelo (B1): qualquer usuário autenticado lê,
      // precisa dele para configurar a catraca da própria unidade.
      catalogo: protectedProcedure.query(() => listTurnstileCatalog()),
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        return listTurnstileIntegrationsForOrganization(input.organizationId);
      }),
      save: protectedProcedure.input(z2.object({
        organizationId: z2.string().uuid(),
        unitId: z2.string().uuid(),
        brand: z2.enum(TURNSTILE_BRAND_KEYS),
        model: z2.string().trim().max(120).optional(),
        modelId: z2.string().uuid().optional(),
        communicationMode: z2.enum(["cloud_webhook", "local_agent"]).optional(),
        port: z2.number().int().min(1).max(65535).optional(),
        serialOrKey: z2.string().trim().max(200).optional(),
        config: z2.record(z2.string(), z2.string()),
        enabled: z2.boolean().default(true)
      })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveTurnstileIntegration(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "turnstile_integration", afterJson: { brand: input.brand, model: input.model, communicationMode: input.communicationMode } });
        return result;
      }),
      delete: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await deleteTurnstileIntegration(input.unitId, input.organizationId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "deleted", entity: "turnstile_integration" });
        return result;
      }),
      // B2 (D-B1): publica o comando "testar conexão" no canal Realtime do
      // dispositivo — a nuvem não espera aqui pela resposta (não há
      // WebSocket persistente em função serverless); o agente reporta o
      // resultado via POST /api/v1/access/test-result e o front revalida
      // `list` para ver lastTestAt/lastTestResult atualizados.
      testConnection: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), unitId: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await requestTurnstileTestConnection(input.unitId, input.organizationId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "requested", entity: "turnstile_test_connection" });
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
      invite: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), email: z2.string().email(), fullName: z2.string().trim().min(2), role: z2.enum(["admin", "manager", "professional", "nutricionista", "viewer"]) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const rawToken = randomUUID2();
        const tokenHash = createHash3("sha256").update(rawToken).digest("hex");
        const invitation = await createOrganizationInvitation({ ...input, invitedByUserId: ctx.user.id, email: input.email.toLowerCase(), rawToken, tokenHash, expiresAt: new Date(Date.now() + 1e3 * 60 * 60 * 72) });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "invitation", entityId: invitation.id, afterJson: { email: input.email.toLowerCase(), role: input.role } });
        return { invitationId: invitation.id, status: "pending" };
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
        const result = await acceptOrganizationInvitation({ tokenHash: createHash3("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email });
        if (!await hasConsent(ctx.user.id, "termos_uso_privacidade")) {
          const policy = await getCurrentPrivacyPolicy();
          await recordConsent({ userId: ctx.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
        }
        await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } });
        return { organizationId: result.organizationId, role: result.role, status: "accepted" };
      }),
      // Aceite de convite de equipe sem exigir conta prévia — assume que o
      // convidado ainda não tem cadastro (ver createOrganizationInvitation):
      // cria a conta Supabase e a vaga na organização em um único passo,
      // no mesmo padrão de journey.acceptInvite (convite de aluno).
      acceptInviteSignup: publicProcedure.input(z2.object({ token: z2.string().trim().min(10), password: z2.string().min(8), consentTermos: z2.literal(true) })).mutation(async ({ ctx, input }) => {
        assertRateLimit(rateLimitKey(ctx.req, "accept-team-invite-signup"), 10, 15 * 60 * 1e3);
        const result = await acceptOrganizationInvitationSignup({ token: input.token, password: input.password });
        const policy = await getCurrentPrivacyPolicy();
        await recordConsent({ userId: result.user.id, consentType: "termos_uso_privacidade", policyVersionId: policy?.id ?? null, ...requestMeta(ctx.req) });
        await recordAuditLog({ organizationId: result.organizationId, userId: result.user.id, action: "accepted", entity: "invitation", entityId: result.invitationId, afterJson: { role: result.role, email: result.user.email } });
        ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
        return { accessToken: result.accessToken, user: result.user, organizationId: result.organizationId, role: result.role, fullName: result.fullName };
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
      const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
      return updateStudentMatricula(input.alunoId, profile.organization_id, { unitId: input.unitId, matriculaEm: input.matriculaEm });
    }),
    // Sem organizationId: aluno consultando seu próprio catálogo (para ler
    // nome/vídeo de exercícios do treino publicado, nunca para editar).
    // Com organizationId: staff montando prescrição — confirma que é da
    // equipe da organização antes de qualquer coisa.
    exercises: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
      let organizationId = input?.organizationId;
      if (organizationId) {
        await assertStaffOfOrganization(ctx.user.id, organizationId);
      } else {
        const profile = await getProfileByUserId(ctx.user.id);
        organizationId = profile?.organization_id ?? void 0;
      }
      if (!organizationId) return [];
      const organization = await getOrganization(organizationId);
      if (!organization) return [];
      const rule = await getGlobalAccessRule(organization.module, organization.plan);
      if (rule && !rule.habilitado) return [];
      return listExercisesCatalog();
    }),
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
    // Motor de pontuação (Sessão A, fatia 2) — staff acompanha o extrato
    // de qualquer aluno da própria organização, mesmo cálculo que o aluno
    // vê de si mesmo em arke.meu.minhaPontuacao.
    pontuacao: router({
      deAluno: protectedProcedure.input(periodoInput.extend({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        const profile = await assertStaffForAluno(ctx.user.id, input.alunoId);
        if (!profile.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return computeScoreAluno(input.alunoId, profile.organization_id, input.desde, input.ate);
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
          const aluno = await getProfileByUserId(input.alunoId);
          if (aluno?.organization_id !== desafio.organization_id) throw new Error("Aluno n\xE3o pertence a esta organiza\xE7\xE3o.");
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
          const aluno = await getProfileByUserId(input.alunoId);
          if (aluno?.organization_id !== desafio.organization_id) throw new Error("Aluno n\xE3o pertence a esta organiza\xE7\xE3o.");
          return setDesafioProgresso({ desafioId: input.desafioId, alunoId: input.alunoId, organizationId: desafio.organization_id, concluido: input.concluido, valorAtual: input.valorAtual, concluidoPor: ctx.user.id, origem: "manual" });
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
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), metrica: z2.string().trim().min(1).max(60).default("Pontua\xE7\xE3o geral"), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), paraTodos: z2.boolean().default(true), modoPontuacao: z2.enum(["manual", "automatica"]).default("manual") })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        const competicao = await createCompeticao({ organization_id: input.organizationId, titulo: input.titulo, descricao: input.descricao || null, metrica: input.metrica, data_inicio: input.dataInicio, data_fim: input.dataFim, para_todos: input.paraTodos, modo_pontuacao: input.modoPontuacao, criado_por: ctx.user.id });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "competicao", entityId: competicao.id, afterJson: input });
        return competicao;
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional(), metrica: z2.string().trim().min(1).max(60), dataInicio: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), dataFim: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), paraTodos: z2.boolean(), modoPontuacao: z2.enum(["manual", "automatica"]) })).mutation(async ({ ctx, input }) => {
        const competicao = await assertStaffForCompeticao(ctx.user.id, input.id);
        const updated = await updateCompeticao(input.id, { titulo: input.titulo, descricao: input.descricao || null, metrica: input.metrica, data_inicio: input.dataInicio, data_fim: input.dataFim, para_todos: input.paraTodos, modo_pontuacao: input.modoPontuacao });
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
          const aluno = await getProfileByUserId(input.alunoId);
          if (aluno?.organization_id !== competicao.organization_id) throw new Error("Aluno n\xE3o pertence a esta organiza\xE7\xE3o.");
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
          const aluno = await getProfileByUserId(input.alunoId);
          if (aluno?.organization_id !== competicao.organization_id) throw new Error("Aluno n\xE3o pertence a esta organiza\xE7\xE3o.");
          return setCompeticaoPontuacao({ competicaoId: input.competicaoId, alunoId: input.alunoId, organizationId: competicao.organization_id, valor: input.valor, atualizadoPor: ctx.user.id, origem: "manual" });
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
      registrarCheckin: protectedProcedure.input(z2.object({ dedicacao: z2.enum(["baixa", "media", "boa", "excelente"]), horasSono: z2.number().min(0).max(24).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return upsertCheckinDiario({ userId: ctx.user.id, organizationId: profile.organization_id, data: todayKey(), dedicacao: input.dedicacao, horasSono: input.horasSono });
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
      }),
      // Auto-registro estendido (Sessão A, fatia 1): treino do dia,
      // adesão à dieta do dia e micrometas semanais — religam
      // treino_calendario/dieta_adesao/compromisso_semanal, que já
      // tinham organization_id/RLS desde a Fase 0 mas nunca foram
      // usadas pelo app. Sempre gerido pelo próprio aluno.
      registrarTreinoDia: protectedProcedure.input(z2.object({ data: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/), tipos: z2.array(z2.string().trim().min(1)).min(1).max(10), duracaoMin: z2.number().int().min(1).max(1e3).optional(), distanciaKm: z2.number().min(0).max(500).optional(), intensidade: z2.string().trim().max(40).optional(), detalhes: z2.string().trim().max(1e3).optional(), observacoes: z2.string().trim().max(1e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return createTreinoCalendario({ alunoId: ctx.user.id, organizationId: profile.organization_id, data: input.data, tipos: input.tipos, duracaoMin: input.duracaoMin, distanciaKm: input.distanciaKm, intensidade: input.intensidade, detalhes: input.detalhes, observacoes: input.observacoes });
      }),
      treinosPeriodo: protectedProcedure.input(z2.object({ desde: z2.string(), ate: z2.string() })).query(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        return listTreinoCalendarioPeriodo(ctx.user.id, input.desde, input.ate);
      }),
      dietaAtiva: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        const [dieta] = await listDietasForAluno(ctx.user.id, true);
        return dieta ?? null;
      }),
      dietaAdesaoHoje: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getDietaAdesaoDoDia(ctx.user.id, todayKey());
      }),
      dietaAdesaoPeriodo: protectedProcedure.input(z2.object({ desde: z2.string(), ate: z2.string() })).query(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        return listDietaAdesaoPeriodo(ctx.user.id, input.desde, input.ate);
      }),
      registrarDietaAdesao: protectedProcedure.input(z2.object({ adesaoPercentual: z2.number().int().min(0).max(100), consumiuDoce: z2.boolean(), consumiuAlcool: z2.boolean(), aguaMl: z2.number().int().min(0).max(2e4).optional(), observacoes: z2.string().trim().max(1e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const [dieta] = await listDietasForAluno(ctx.user.id, true);
        if (!dieta) throw new Error("Voc\xEA ainda n\xE3o tem um plano alimentar publicado para registrar ades\xE3o.");
        return upsertDietaAdesao({ alunoId: ctx.user.id, dietaId: dieta.id, organizationId: profile.organization_id, data: todayKey(), adesaoPercentual: input.adesaoPercentual, consumiuDoce: input.consumiuDoce, consumiuAlcool: input.consumiuAlcool, aguaMl: input.aguaMl, observacoes: input.observacoes });
      }),
      compromissoSemanaAtual: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const compromisso = await getOrCreateCompromissoSemanal(ctx.user.id, profile.organization_id, currentWeekKey());
        const metas = await listCompromissoMetas(compromisso.id);
        return { compromisso, metas };
      }),
      criarMetaSemana: protectedProcedure.input(z2.object({ texto: z2.string().trim().min(2).max(300) })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const compromisso = await getOrCreateCompromissoSemanal(ctx.user.id, profile.organization_id, currentWeekKey());
        return createCompromissoMeta({ compromissoId: compromisso.id, texto: input.texto });
      }),
      marcarMetaConcluida: protectedProcedure.input(z2.object({ metaId: z2.string().uuid(), concluida: z2.boolean() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const meta = await getCompromissoMetaComDono(input.metaId);
        if (!meta || meta.compromisso_semanal?.user_id !== ctx.user.id) throw new Error("Meta n\xE3o encontrada.");
        return setCompromissoMetaConcluida(input.metaId, input.concluida);
      }),
      // Motor de pontuação (Sessão A, fatia 2) — só leitura por enquanto,
      // checkpoint antes de alimentar desafios/competições automáticos.
      minhaPontuacao: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return computeScoreAluno(ctx.user.id, profile.organization_id, input.desde, input.ate);
      }),
      comparativo: protectedProcedure.input(periodoInput).query(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        return computeComparativoAluno(ctx.user.id, profile.organization_id, input.desde, input.ate);
      }),
      // Objetivos e valores-guia (religa aluno_objetivos/aluno_valores —
      // porte fiel da fórmula de pontuação original, que usa esses dados
      // como entrada). Cada revisão insere uma linha nova; a mais recente
      // é a vigente, mesmo padrão do arke-app original.
      objetivos: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getAlunoObjetivosRecente(ctx.user.id);
      }),
      salvarObjetivos: protectedProcedure.input(z2.object({ objetivos: z2.array(z2.string().trim().min(1)).max(3), conquistas: z2.string().trim().max(1e3).optional(), dificuldades: z2.string().trim().max(1e3).optional(), visao3Meses: z2.string().trim().max(1e3).optional(), visao3Anos: z2.string().trim().max(1e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const proximaRevisao = /* @__PURE__ */ new Date();
        proximaRevisao.setMonth(proximaRevisao.getMonth() + 3);
        return createAlunoObjetivos({ userId: ctx.user.id, organizationId: profile.organization_id, objetivos: input.objetivos, conquistas: input.conquistas, dificuldades: input.dificuldades, visao3Meses: input.visao3Meses, visao3Anos: input.visao3Anos, proximaRevisao: proximaRevisao.toISOString().slice(0, 10) });
      }),
      valores: protectedProcedure.query(async ({ ctx }) => {
        await assertAlunoTemArke(ctx.user.id);
        return getAlunoValoresRecente(ctx.user.id);
      }),
      salvarValores: protectedProcedure.input(z2.object({ valores: z2.array(z2.string().trim().min(1)).min(3).max(3) })).mutation(async ({ ctx, input }) => {
        await assertAlunoTemArke(ctx.user.id);
        const profile = await getProfileByUserId(ctx.user.id);
        if (!profile?.organization_id) throw new Error("Aluno sem organiza\xE7\xE3o vinculada.");
        const validade = /* @__PURE__ */ new Date();
        validade.setMonth(validade.getMonth() + 6);
        return createAlunoValores({ userId: ctx.user.id, organizationId: profile.organization_id, valores: input.valores, validade: validade.toISOString().slice(0, 10) });
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
        const post = await getFeedPost(input.postId);
        if (!post || post.organization_id !== profile.organization_id) throw new Error("Publica\xE7\xE3o n\xE3o encontrada.");
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
          const post = await getFeedPost(input.postId);
          if (!post || post.organization_id !== profile.organization_id) throw new Error("Publica\xE7\xE3o n\xE3o encontrada.");
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
          valorAtual: progressoByDesafio.get(desafio.id)?.valor_atual ?? null,
          origem: progressoByDesafio.get(desafio.id)?.origem ?? null
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
          const origemByAluno = new Map(pontuacoes.map((item) => [item.aluno_id, item.origem]));
          const ranking = participantes.map((participante) => ({ alunoId: participante.aluno_id, nome: nameByAluno.get(participante.aluno_id) ?? "Aluno", valor: valorByAluno.get(participante.aluno_id) ?? 0, origem: origemByAluno.get(participante.aluno_id) ?? null })).sort((a, b) => b.valor - a.valor).map((entry, index) => ({ ...entry, posicao: index + 1 }));
          return { id: competicao.id, titulo: competicao.titulo, descricao: competicao.descricao, metrica: competicao.metrica, dataInicio: competicao.data_inicio, dataFim: competicao.data_fim, modoPontuacao: competicao.modo_pontuacao, ranking };
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
        const alunoProfile = await getProfileByUserId(input.alunoId);
        if (alunoProfile?.organization_id !== input.organizationId) throw new Error("Aluno n\xE3o pertence a esta organiza\xE7\xE3o.");
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
  }),
  // Cadastro administrativo do aluno — existe independente de login (ver
  // 20260916_cadastro_direto_alunos_e_importacao.sql). journey.inviteMember
  // continua existindo à parte, como ação opcional em cima de um aluno já
  // cadastrado aqui.
  alunos: router({
    list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return listAlunos(input.organizationId);
    }),
    create: protectedProcedure.input(z2.object({
      organizationId: z2.string().uuid(),
      unitId: z2.string().uuid().optional(),
      planoId: z2.string().uuid().optional(),
      nome: z2.string().trim().min(2).max(160),
      cpf: z2.string().trim().optional(),
      email: z2.string().email().optional(),
      telefone: z2.string().trim().max(40).optional(),
      dataNascimento: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      responsavelNome: z2.string().trim().max(160).optional(),
      responsavelCpf: z2.string().trim().optional(),
      valorMensal: z2.number().min(0).optional(),
      diaVencimento: z2.number().int().min(1).max(31).optional()
    })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      return createAluno({ ...input, origem: "manual", criadoPor: ctx.user.id });
    }),
    update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), organizationId: z2.string().uuid(), data: z2.object({
      nome: z2.string().trim().min(2).max(160).optional(),
      unitId: z2.string().uuid().optional().nullable(),
      planoId: z2.string().uuid().optional().nullable(),
      cpf: z2.string().trim().optional().nullable(),
      email: z2.string().email().optional().nullable(),
      telefone: z2.string().trim().max(40).optional().nullable(),
      valorMensal: z2.number().min(0).optional().nullable(),
      diaVencimento: z2.number().int().min(1).max(31).optional().nullable(),
      status: z2.enum(["ativo", "inativo", "trancado"]).optional()
    }) })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      const { unitId, planoId, diaVencimento, valorMensal, ...rest } = input.data;
      return updateAluno(input.id, input.organizationId, { ...rest, unit_id: unitId, plano_id: planoId, dia_vencimento: diaVencimento, valor_mensal: valorMensal });
    })
  }),
  // Planos de mensalidade da própria academia (não confundir com o plano
  // da assinatura ArkeFit em saas.organizations — ver org_membership_plans).
  planos: router({
    list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return listMembershipPlans(input.organizationId);
    }),
    create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), nome: z2.string().trim().min(2).max(120), valorMensal: z2.number().min(0), periodicidade: z2.enum(["mensal", "trimestral", "semestral", "anual"]).default("mensal") })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      return createMembershipPlan(input);
    }),
    update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), organizationId: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2).max(120).optional(), valorMensal: z2.number().min(0).optional(), periodicidade: z2.enum(["mensal", "trimestral", "semestral", "anual"]).optional(), ativo: z2.boolean().optional() }) })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      return updateMembershipPlan(input.id, input.organizationId, input.data);
    })
  }),
  // Importação de dados na implantação de um cliente novo. O cliente
  // parseia o CSV/XLSX no navegador (papaparse/xlsx) e manda linhas já em
  // JSON — sem upload multipart no servidor. preview nunca grava nada;
  // commit reaproveita a mesma validação e sempre reenvia as mesmas linhas.
  importacao: router({
    history: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
      await assertStaffOfOrganization(ctx.user.id, input.organizationId);
      return listImportBatches(input.organizationId);
    }),
    preview: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), entity: z2.enum(["unidades", "planos", "alunos", "leads", "turmas"]), rows: z2.array(z2.record(z2.string(), z2.string())).min(1).max(1e4) })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      return previewImport(input.entity, input.rows, input.organizationId);
    }),
    commit: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), entity: z2.enum(["unidades", "planos", "alunos", "leads", "turmas"]), fileName: z2.string().trim().min(1).max(200), rows: z2.array(z2.record(z2.string(), z2.string())).min(1).max(1e4) })).mutation(async ({ ctx, input }) => {
      await ownerOrAdmin(ctx.user.id, input.organizationId);
      const batch = await createImportBatch({ organizationId: input.organizationId, entity: input.entity, fileName: input.fileName, totalRows: input.rows.length, validRows: 0, errorRows: 0, errors: [], uploadedBy: ctx.user.id });
      const result = await commitImport(input.entity, input.rows, input.organizationId, ctx.user.id);
      await finalizeImportBatch(batch.id, input.organizationId, { validRows: result.inserted, errorRows: result.errors.length, errors: result.errors });
      return { batchId: batch.id, inserted: result.inserted, errors: result.errors };
    })
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
    if (configured && decision === "allowed" && organizationId && studentId) {
      registrarFrequencia({ alunoId: studentId, organizationId, unitId: unitId || void 0, origem: "catraca" }).catch((error) => {
        captureException2(error, { route: "access.check-in.registrarFrequencia", organizationId, studentId });
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
  const requireDeviceKey = (req, res) => {
    const expectedKey = process.env.CATRACA_API_KEY;
    const providedKey = normalize(req.header("x-arke-device-key"));
    if (expectedKey && providedKey !== expectedKey) {
      res.status(401).json({ ok: false, code: "INVALID_DEVICE_KEY", message: "Dispositivo n\xE3o autorizado." });
      return false;
    }
    return true;
  };
  app.post("/api/v1/access/heartbeat", async (req, res) => {
    if (!requireDeviceKey(req, res)) return;
    const deviceId = normalize((req.body ?? {}).deviceId);
    const organizationId = normalize((req.body ?? {}).organizationId);
    if (!deviceId || !organizationId) return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "deviceId e organizationId s\xE3o obrigat\xF3rios." });
    try {
      const result = await recordTurnstileHeartbeat(deviceId, organizationId);
      if (!result.success) return res.status(404).json({ ok: false, code: "DEVICE_NOT_FOUND", message: "Catraca n\xE3o encontrada." });
      return res.status(200).json({ ok: true });
    } catch (error) {
      captureException2(error, { route: "access.heartbeat", deviceId, organizationId });
      return res.status(502).json({ ok: false, code: "HEARTBEAT_FAILED", message: "N\xE3o foi poss\xEDvel registrar o heartbeat." });
    }
  });
  app.post("/api/v1/access/test-result", async (req, res) => {
    if (!requireDeviceKey(req, res)) return;
    const body = req.body ?? {};
    const deviceId = normalize(body.deviceId);
    const organizationId = normalize(body.organizationId);
    const result = body.result;
    if (!deviceId || !organizationId || result !== "success" && result !== "failed") {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "deviceId, organizationId e result ('success'|'failed') s\xE3o obrigat\xF3rios." });
    }
    try {
      const outcome = await reportTurnstileTestResult(deviceId, organizationId, result, normalize(body.message) || void 0);
      if (!outcome.success) return res.status(404).json({ ok: false, code: "DEVICE_NOT_FOUND", message: "Catraca n\xE3o encontrada." });
      return res.status(200).json({ ok: true });
    } catch (error) {
      captureException2(error, { route: "access.test-result", deviceId, organizationId });
      return res.status(502).json({ ok: false, code: "TEST_RESULT_FAILED", message: "N\xE3o foi poss\xEDvel registrar o resultado do teste." });
    }
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
      if (body.payment) await upsertAsaasPayment(body.payment, body.event);
      const result = await persistAsaasEvent({ eventId: body.id, event: body.event, occurredAt: body.dateCreated, payload: body });
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
        description: `Repasse M\xF3dulo Arke \u2014 ${alunosAtivos} aluno(s) com Arke x ${formatBRL(ARKE_ALUNO_WHOLESALE_CENTS)}`
      });
      await markArkeRepasseCharged(arkeModule.organization_id, hoje.toISOString().slice(0, 10));
      resultado.organizacoesCobradas += 1;
      try {
        await upsertAsaasPayment(payment, "PAYMENT_CREATED", arkeModule.organization_id);
      } catch (persistError) {
        captureException2(persistError, { job: "arke_repasse_mensal.upsertAsaasPayment", organizationId: arkeModule.organization_id, asaasPaymentId: payment?.id });
      }
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

// server/arkeDesafiosAutomaticos.ts
var STAFF_ROLES2 = ["owner", "admin", "manager", "professional", "nutricionista"];
async function participantesDoDesafio(desafio, alunosComArkeAtivo) {
  if (desafio.para_todos) return alunosComArkeAtivo;
  const participantes = await listDesafioParticipantes(desafio.id);
  return participantes.map((p) => p.aluno_id);
}
async function runArkeDesafiosAutomaticos() {
  const resultado = { desafiosProcessados: 0, progressosAtualizados: 0, concluidosAgora: 0, falhas: 0 };
  const hoje = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const arkeModule of await listArkeModulesEnabled()) {
    const organizationId = arkeModule.organization_id;
    let alunosComArkeAtivo = null;
    let staffNotificado = null;
    let studentsNameById = null;
    const desafios = (await listDesafios(organizationId)).filter((d) => d.tipo !== "livre" && d.data_inicio <= hoje);
    for (const desafio of desafios) {
      resultado.desafiosProcessados += 1;
      if (!alunosComArkeAtivo) alunosComArkeAtivo = await listAlunosComArkeAtivoIds(organizationId);
      let participantes;
      let progressoExistente;
      try {
        [participantes, progressoExistente] = await Promise.all([
          participantesDoDesafio(desafio, alunosComArkeAtivo),
          listDesafioProgressoForDesafio(desafio.id)
        ]);
      } catch (error) {
        captureException2(error, { job: "arke_desafios_automaticos", organizationId, desafioId: desafio.id });
        resultado.falhas += 1;
        continue;
      }
      const progressoByAluno = new Map(progressoExistente.map((p) => [p.aluno_id, p]));
      const encerrado = desafio.data_fim < hoje;
      for (const alunoId of participantes) {
        const existente = progressoByAluno.get(alunoId);
        if (existente?.origem === "manual") continue;
        try {
          const auto = await calcAuto(alunoId, desafio);
          if (!auto) continue;
          const concluido = auto.isInverse ? auto.valor <= auto.meta && encerrado : auto.meta > 0 && auto.valor >= auto.meta;
          const jaEstavaConcluido = existente?.concluido ?? false;
          await setDesafioProgresso({ desafioId: desafio.id, alunoId, organizationId, concluido, valorAtual: auto.valor, origem: "automatico" });
          resultado.progressosAtualizados += 1;
          if (concluido && !jaEstavaConcluido) {
            resultado.concluidosAgora += 1;
            if (!studentsNameById) studentsNameById = new Map((await listStudentsInOrganization(organizationId)).map((s) => [s.user_id, s.full_name || "Aluno"]));
            if (!staffNotificado) staffNotificado = await listActiveStaffUserIds(organizationId, STAFF_ROLES2);
            const nome = studentsNameById.get(alunoId) ?? "Aluno";
            const titulo = "\u{1F3C6} Desafio conclu\xEDdo";
            const mensagem = `${nome} concluiu automaticamente "${desafio.titulo}".`;
            await Promise.all(staffNotificado.map(async (userId) => {
              await createNotificacao({ userId, titulo, mensagem, tipo: "desafio" });
              sendPushToUser(userId, { title: titulo, body: mensagem, url: "/" }).catch(() => {
              });
            }));
          }
        } catch (error) {
          captureException2(error, { job: "arke_desafios_automaticos", organizationId, desafioId: desafio.id, alunoId });
          resultado.falhas += 1;
        }
      }
    }
  }
  return resultado;
}

// server/arkeCompeticoesAutomaticas.ts
async function runArkeCompeticoesAutomaticas() {
  const resultado = { competicoesProcessadas: 0, pontuacoesAtualizadas: 0, falhas: 0 };
  for (const arkeModule of await listArkeModulesEnabled()) {
    const organizationId = arkeModule.organization_id;
    let alunosComArkeAtivo = null;
    const competicoes = (await listCompeticoes(organizationId)).filter((c) => c.modo_pontuacao === "automatica");
    for (const competicao of competicoes) {
      resultado.competicoesProcessadas += 1;
      if (!alunosComArkeAtivo) alunosComArkeAtivo = await listAlunosComArkeAtivoIds(organizationId);
      let participantes;
      let pontuacaoExistente;
      try {
        [participantes, pontuacaoExistente] = await Promise.all([
          competicao.para_todos ? Promise.resolve(alunosComArkeAtivo) : listCompeticaoParticipantes(competicao.id).then((rows) => rows.map((row) => row.aluno_id)),
          listCompeticaoPontuacaoForCompeticao(competicao.id)
        ]);
      } catch (error) {
        captureException2(error, { job: "arke_competicoes_automaticas", organizationId, competicaoId: competicao.id });
        resultado.falhas += 1;
        continue;
      }
      const origemByAluno = new Map(pontuacaoExistente.map((item) => [item.aluno_id, item.origem]));
      for (const alunoId of participantes) {
        if (origemByAluno.get(alunoId) === "manual") continue;
        try {
          const score = await computeScoreAluno(alunoId, organizationId, competicao.data_inicio, competicao.data_fim);
          await setCompeticaoPontuacao({ competicaoId: competicao.id, alunoId, organizationId, valor: score.total, origem: "automatico" });
          resultado.pontuacoesAtualizadas += 1;
        } catch (error) {
          captureException2(error, { job: "arke_competicoes_automaticas", organizationId, competicaoId: competicao.id, alunoId });
          resultado.falhas += 1;
        }
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
      const [resultado, arkeRepasse, arkeLembretes, arkeDesafios, arkeCompeticoes] = await Promise.all([runAutomacaoDiaria(), runArkeRepasseMensal(), runArkeLembretesDiarios(), runArkeDesafiosAutomaticos(), runArkeCompeticoesAutomaticas()]);
      return res.status(200).json({ ok: true, ...resultado, arkeRepasse, arkeLembretes, arkeDesafios, arkeCompeticoes });
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

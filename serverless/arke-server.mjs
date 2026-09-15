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

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";

// server/_core/env.ts
var ENV = {
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/_core/notification.ts
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
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
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
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
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

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
async function request(table, init = {}, query = "") {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers ?? {} }
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
var PLAN_LIMITS = { starter: { maxUnits: 1, maxUsers: 12 }, growth: { maxUnits: 3, maxUsers: 32 }, scale: { maxUnits: 10, maxUsers: 100 }, unlimited: { maxUnits: 999, maxUsers: 99999 }, essencial: { maxUnits: 1, maxUsers: 3 }, performance: { maxUnits: 1, maxUsers: 8 }, premium: { maxUnits: 1, maxUsers: 20 } };
var PLAN_AMOUNTS = { starter: 39900, growth: 79900, scale: 149e3, unlimited: 349e3, essencial: 14900, performance: 24900, premium: 19900 };
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
  const amountCents = PLAN_AMOUNTS[input.plan];
  const limits = PLAN_LIMITS[input.plan];
  await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ plan: input.plan, max_units: limits.maxUnits, max_users: limits.maxUsers }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  await request("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ plan: input.plan, amount_cents: amountCents, ...input.status ? { status: input.status } : {} }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
  return getOrganizationSubscription(input.organizationId);
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
function config2() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase n\xE3o configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}
async function request2(table, init = {}, query = "") {
  const { url, key } = config2();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers ?? {} }
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
  await request2("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usu\xE1rio <strong>${idValue}</strong> foi removido pela administra\xE7\xE3o.</p>`);
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
  if (!apiKey) return { simulated: true };
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
async function listExercisesCatalog() {
  return request2("exercicios", {}, "?select=id,nome,grupo_muscular&order=nome.asc");
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
  const rows = await request2("leads", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, nome: input.nome, telefone: input.telefone || void 0, email: input.email || void 0, origem: input.origem || void 0, responsavel_id: input.responsavelId || void 0, notas: input.notas || void 0, criado_por: input.criadoPor || void 0 }) });
  return rows[0];
}
async function updateLead(idValue, data) {
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ nome: data.nome, telefone: data.telefone, email: data.email, origem: data.origem, responsavel_id: data.responsavelId, notas: data.notas }) }, `?id=eq.${encodeURIComponent(idValue)}`);
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
  if (lead.estagio === "perdido") throw new Error("Este lead est\xE1 marcado como perdido.");
  if (!lead.email) throw new Error("Informe o e-mail do lead antes de converter \u2014 o convite de aluno exige e-mail.");
  const invitation = await inviteMember({ organizationId: lead.organization_id, invitedByUserId, email: lead.email, fullName: lead.nome });
  const rows = await request2("leads", { method: "PATCH", body: JSON.stringify({ estagio: "matriculado", convertido_em: (/* @__PURE__ */ new Date()).toISOString(), member_invitation_id: invitation.id }) }, `?id=eq.${encodeURIComponent(idValue)}`);
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

// server/asaas.ts
function asaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY ?? "";
  const baseUrl = (process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
  if (!apiKey) throw new Error("ASAAS_API_KEY n\xE3o configurada.");
  return { apiKey, baseUrl };
}
async function asaasRequest(path, init = {}) {
  const { apiKey, baseUrl } = asaasConfig();
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { access_token: apiKey, "Content-Type": "application/json", ...init.headers ?? {} } });
  if (!response.ok) throw new Error(`Asaas ${response.status}: ${await response.text()}`);
  return response.json();
}
function asaasSandboxConfigured() {
  return Boolean(process.env.ASAAS_API_KEY);
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
async function supabaseRequest(table, init = {}, query = "") {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers ?? {} } });
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
async function upsertAsaasPayment(payment, event) {
  const asaasId = String(payment.id ?? "");
  if (!asaasId) return;
  await supabaseRequest("asaas_payments", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ asaas_id: asaasId, customer_id: payment.customer ?? null, value: payment.value ?? null, billing_type: payment.billingType ?? null, due_date: payment.dueDate ?? null, status: payment.status ?? event, invoice_url: payment.invoiceUrl ?? null, bank_slip_url: payment.bankSlipUrl ?? null, raw_payload: payment, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, "?on_conflict=asaas_id");
}
async function listStoredAsaasPayments(limit = 20) {
  return supabaseRequest("asaas_payments", {}, `?select=*&order=updated_at.desc&limit=${limit}`);
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

// server/routers.ts
var organizationIdInput = z2.object({ organizationId: z2.string().uuid() });
var moduleName = z2.enum(["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"]);
var roleName = z2.enum(["owner", "admin", "manager", "professional", "nutricionista", "viewer"]);
var auditFilterInput = z2.object({ organizationId: z2.string().uuid(), from: z2.string().optional(), to: z2.string().optional(), userId: z2.string().uuid().optional(), entity: z2.string().max(64).optional() });
var auditFilters = (input) => ({ from: input.from ? /* @__PURE__ */ new Date(`${input.from}T00:00:00.000Z`) : void 0, to: input.to ? /* @__PURE__ */ new Date(`${input.to}T23:59:59.999Z`) : void 0, userId: input.userId, entity: input.entity });
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
var assertStaffForAtendimento = async (userId, atendimentoId) => {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) throw new Error("Atendimento n\xE3o encontrado.");
  await assertStaffOfOrganization(userId, atendimento.organization_id);
  return atendimento;
};
var assertStaffForLead = async (userId, leadId) => {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead n\xE3o encontrado.");
  await assertStaffOfOrganization(userId, lead.organization_id);
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
      const result = await signInWithSupabase(input.email, input.password);
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return result;
    }),
    recoverPassword: publicProcedure.input(z2.object({ email: z2.string().email() })).mutation(({ input }) => createPasswordRecoveryCode(normalizeEmail(input.email))),
    setPassword: publicProcedure.input(z2.object({ email: z2.string().email(), code: z2.string().trim().min(4), password: z2.string().min(8) })).mutation(async ({ ctx, input }) => {
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
  admin: router({
    status: publicProcedure.query(() => ({ configured: hasSupabaseConfig() })),
    lookupCnpj: publicProcedure.input(z2.object({ cnpj: z2.string().min(14).max(18) })).mutation(({ input }) => lookupCnpj(input.cnpj)),
    users: router({
      list: publicProcedure.query(() => listAppUsers()),
      create: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2).max(80), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable(), profileData: z2.record(z2.string(), z2.string()).optional() })).mutation(({ input }) => createAppUser({ ...input, profile_data: input.profileData, email: normalizeEmail(input.email) })),
      update: publicProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable(), profileData: z2.record(z2.string(), z2.string()).optional() }) })).mutation(({ input }) => updateAppUser(input.id, { ...input.data, profile_data: input.data.profileData, email: normalizeEmail(input.data.email) })),
      delete: publicProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppUser(input.id))
    }),
    students: router({
      list: publicProcedure.query(() => listAppStudents()),
      create: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) })).mutation(({ input }) => createAppStudent(input)),
      update: publicProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) }) })).mutation(({ input }) => updateAppStudent(input.id, input.data)),
      delete: publicProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppStudent(input.id))
    })
  }),
  globalLibrary: router({
    list: adminProcedure.query(() => listGlobalLibrary()),
    exercises: router({
      create: adminProcedure.input(z2.object({ nome: z2.string().trim().min(2), grupo_muscular: z2.string().trim().min(2), descricao: z2.string().trim().optional(), instrucoes: z2.string().trim().optional(), video_url: z2.string().url().optional(), imagem_url: z2.string().url().optional(), equipamento: z2.string().trim().optional() })).mutation(({ ctx, input }) => createGlobalExercise({ ...input, created_by: ctx.user.id })),
      update: adminProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2), grupo_muscular: z2.string().trim().min(2), descricao: z2.string().trim().optional().nullable(), instrucoes: z2.string().trim().optional().nullable(), video_url: z2.string().url().optional().nullable(), imagem_url: z2.string().url().optional().nullable(), equipamento: z2.string().trim().optional().nullable() }) })).mutation(({ input }) => updateGlobalExercise(input.id, input.data)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalExercise(input.id))
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
    accessRules: router({
      upsert: adminProcedure.input(z2.object({ modulo: z2.enum(["academia", "studio", "profissional", "nutricionista"]), plano: z2.string().trim().min(2), habilitado: z2.boolean(), requer_consultoria: z2.boolean().default(true) })).mutation(({ input }) => upsertGlobalAccessRule(input)),
      delete: adminProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteGlobalAccessRule(input.id))
    })
  }),
  billing: router({
    asaasStatus: publicProcedure.query(() => ({ configured: asaasSandboxConfigured(), environment: "sandbox" })),
    asaasAccount: publicProcedure.query(() => getAsaasAccount()),
    asaasPayments: publicProcedure.input(z2.object({ limit: z2.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listAsaasPayments(input?.limit ?? 20)),
    asaasStoredPayments: publicProcedure.input(z2.object({ limit: z2.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listStoredAsaasPayments(input?.limit ?? 20)),
    createAsaasCustomer: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), cpfCnpj: z2.string().trim().optional() })).mutation(({ input }) => createAsaasCustomer(input)),
    createAsaasPayment: publicProcedure.input(z2.object({ customer: z2.string().min(2), value: z2.number().positive(), dueDate: z2.string(), billingType: z2.enum(["UNDEFINED", "PIX", "BOLETO", "CREDIT_CARD", "DEBIT_CARD"]), description: z2.string().trim().min(2) })).mutation(({ input }) => createAsaasPayment(input)),
    createAsaasWebhook: publicProcedure.input(z2.object({ url: z2.string().url(), email: z2.string().email() })).mutation(({ input }) => createAsaasWebhook(input))
  }),
  saas: router({
    organizations: router({
      bySlug: publicProcedure.input(z2.object({ slug: z2.string().trim().toLowerCase().min(1).max(120) })).query(({ input }) => getOrganizationBySlug(input.slug)),
      list: protectedProcedure.query(({ ctx }) => getOrganizationsForUser(ctx.user.id)),
      create: protectedProcedure.input(z2.object({ clientId: z2.string().uuid(), module: z2.string().trim().min(2).optional(), logoUrl: z2.string().max(1e6).optional(), primaryColor: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), name: z2.string().trim().min(2).max(160), slug: z2.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), plan: z2.enum(["starter", "growth", "scale", "unlimited", "essencial", "performance", "premium"]) })).mutation(({ ctx, input }) => createOrganizationWithOwner({ userId: ctx.user.id, ...input })),
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
      updateSubscription: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), plan: z2.enum(["starter", "growth", "scale", "unlimited", "essencial", "performance", "premium"]), status: z2.enum(["trialing", "active", "past_due", "canceled"]).optional() })).mutation(async ({ ctx, input }) => {
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
      acceptInvite: protectedProcedure.input(z2.object({ token: z2.string().min(16).max(128) })).mutation(async ({ ctx, input }) => {
        if (!ctx.user.email) throw new Error("Authenticated user email is required");
        const result = await acceptOrganizationInvitation({ tokenHash: createHash2("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email });
        await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } });
        return { organizationId: result.organizationId, role: result.role, status: "accepted" };
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
        return createTreino({ aluno_id: input.alunoId, titulo: input.titulo, tipo: input.tipo, descricao: input.descricao || void 0, organization_id: profile.organization_id, criado_por: ctx.user.id });
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), tipo: z2.string().trim().min(1), descricao: z2.string().trim().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        return updateTreino(input.id, input.data);
      }),
      saveExercicios: protectedProcedure.input(z2.object({ treinoId: z2.string().uuid(), items: z2.array(treinoExercicioItem) })).mutation(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.treinoId, TREINO_BLOCKED_ROLES);
        return replaceTreinoExercicios(input.treinoId, input.items);
      }),
      publish: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        return publishTreino(input.id, ctx.user.id);
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForTreino(ctx.user.id, input.id, TREINO_BLOCKED_ROLES);
        return deleteTreino(input.id);
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
        return createDieta({ aluno_id: input.alunoId, titulo: input.titulo, descricao: input.descricao || void 0, arquivo_url: input.arquivoUrl || void 0, organization_id: profile.organization_id, criado_por: ctx.user.id });
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ titulo: z2.string().trim().min(2), descricao: z2.string().trim().optional().nullable(), arquivo_url: z2.string().url().optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        return updateDieta(input.id, input.data);
      }),
      publish: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        return publishDieta(input.id, ctx.user.id);
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForDieta(ctx.user.id, input.id, DIETA_BLOCKED_ROLES);
        return deleteDieta(input.id);
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
    acceptInvite: publicProcedure.input(z2.object({ token: z2.string().trim().min(10), password: z2.string().min(8) })).mutation(async ({ ctx, input }) => {
      const result = await acceptMemberInvitation(input.token, input.password);
      ctx.res.cookie(SUPABASE_ACCESS_COOKIE, result.accessToken, { ...getSessionCookieOptions(ctx.req), maxAge: 1e3 * 60 * 60 * 24 * 30 });
      return { accessToken: result.accessToken, user: result.user, organizationId: result.organizationId };
    }),
    myAcolhimento: protectedProcedure.query(({ ctx }) => getAcolhimento(ctx.user.id)),
    submitAcolhimento: protectedProcedure.input(acolhimentoInput).mutation(({ ctx, input }) => upsertAcolhimento(ctx.user.id, input)),
    staffAcolhimento: protectedProcedure.input(z2.object({ alunoId: z2.string().uuid() })).query(async ({ ctx, input }) => {
      await assertStaffForAluno(ctx.user.id, input.alunoId);
      return getAcolhimento(input.alunoId);
    })
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
    myOrganizations: protectedProcedure.query(async ({ ctx }) => (await getOrganizationsForUser(ctx.user.id)).filter((item) => STAFF_ROLES.includes(item.membership.role))),
    leads: router({
      list: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return listLeadsForOrganization(input.organizationId);
      }),
      create: protectedProcedure.input(z2.object({ organizationId: z2.string().uuid(), nome: z2.string().trim().min(2).max(160), telefone: z2.string().trim().max(40).optional(), email: z2.string().email().optional(), origem: z2.string().trim().max(80).optional(), notas: z2.string().trim().max(4e3).optional() })).mutation(async ({ ctx, input }) => {
        await assertStaffOfOrganization(ctx.user.id, input.organizationId);
        return createLead({ organizationId: input.organizationId, nome: input.nome, telefone: input.telefone, email: input.email, origem: input.origem, notas: input.notas, criadoPor: ctx.user.id });
      }),
      update: protectedProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ nome: z2.string().trim().min(2).max(160).optional(), telefone: z2.string().trim().max(40).optional().nullable(), email: z2.string().email().optional().nullable(), origem: z2.string().trim().max(80).optional().nullable(), responsavelId: z2.string().uuid().optional().nullable(), notas: z2.string().trim().max(4e3).optional().nullable() }) })).mutation(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.id);
        return updateLead(input.id, input.data);
      }),
      delete: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.id);
        return deleteLead(input.id);
      }),
      moverEstagio: protectedProcedure.input(z2.object({ id: z2.string().uuid(), estagio: z2.enum(["novo", "contato_feito", "visita_agendada"]) })).mutation(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.id);
        return moverEstagioLead(input.id, input.estagio);
      }),
      marcarPerdido: protectedProcedure.input(z2.object({ id: z2.string().uuid(), motivo: z2.string().trim().min(2).max(500) })).mutation(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.id);
        return marcarLeadPerdido(input.id, input.motivo);
      }),
      converter: protectedProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.id);
        return converterLead(input.id, ctx.user.id);
      }),
      atividades: protectedProcedure.input(z2.object({ leadId: z2.string().uuid() })).query(async ({ ctx, input }) => {
        await assertStaffForLead(ctx.user.id, input.leadId);
        return listLeadAtividades(input.leadId);
      }),
      criarNota: protectedProcedure.input(z2.object({ leadId: z2.string().uuid(), descricao: z2.string().trim().min(2).max(4e3) })).mutation(async ({ ctx, input }) => {
        const lead = await assertStaffForLead(ctx.user.id, input.leadId);
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

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/access.ts
import { randomUUID as randomUUID3 } from "node:crypto";
var normalize = (value) => typeof value === "string" ? value.trim() : "";
function registerAccessRoutes(app) {
  app.post("/api/v1/access/check-in", (req, res) => {
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
    const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
    const eventId = `access_${randomUUID3()}`;
    if (!denied && organizationId && studentId) {
      registrarFrequencia({ alunoId: studentId, organizationId, unitId: unitId || void 0, origem: "catraca" }).catch(() => {
      });
    }
    return res.status(200).json({
      ok: true,
      mode: expectedKey ? "configured" : "demo",
      eventId,
      decision: denied ? "denied" : "allowed",
      academyId,
      unitId: unitId || null,
      studentId: studentId || null,
      document: document || null,
      deviceId,
      provider,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      message: denied ? "Acesso bloqueado para esta credencial." : "Acesso liberado."
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
      const resultado = await runAutomacaoDiaria();
      return res.status(200).json({ ok: true, ...resultado });
    } catch (error) {
      console.error("[Automa\xE7\xE3o cron] failed", error);
      return res.status(500).json({ ok: false });
    }
  });
}

// serverless/entry.ts
function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerAccessRoutes(app);
  registerAsaasWebhook(app);
  registerAutomacaoCron(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return app;
}
var entry_default = createApp();
export {
  createApp,
  entry_default as default
};

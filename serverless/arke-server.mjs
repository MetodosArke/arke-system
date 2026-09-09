// serverless/entry.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
import { z as z2 } from "zod";
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

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
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
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
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  plan: mysqlEnum("plan", ["starter", "growth", "scale"]).default("starter").notNull(),
  status: mysqlEnum("status", ["trial", "active", "past_due", "canceled"]).default("trial").notNull(),
  logoUrl: varchar("logoUrl", { length: 512 }),
  primaryColor: varchar("primaryColor", { length: 32 }).default("#c99518").notNull(),
  maxUnits: int("maxUnits").default(1).notNull(),
  maxUsers: int("maxUsers").default(12).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var memberships = mysqlTable("memberships", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "manager", "professional", "viewer"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["active", "invited", "suspended"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ membershipIdx: uniqueIndex("memberships_org_user_idx").on(table.organizationId, table.userId) }));
var organizationUnits = mysqlTable("organizationUnits", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull(),
  city: varchar("city", { length: 120 }),
  status: mysqlEnum("status", ["active", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ unitSlugIdx: uniqueIndex("organization_units_org_slug_idx").on(table.organizationId, table.slug) }));
var modulePolicies = mysqlTable("modulePolicies", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  unitId: int("unitId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "manager", "professional", "viewer"]).notNull(),
  module: varchar("module", { length: 64 }).notNull(),
  canView: int("canView").default(1).notNull(),
  canManage: int("canManage").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ policyIdx: uniqueIndex("module_policies_scope_idx").on(table.organizationId, table.unitId, table.role, table.module) }));
var subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  plan: mysqlEnum("plan", ["starter", "growth", "scale"]).notNull(),
  status: mysqlEnum("status", ["trialing", "active", "past_due", "canceled"]).default("trialing").notNull(),
  billingCycle: mysqlEnum("billingCycle", ["monthly", "yearly"]).default("monthly").notNull(),
  amountCents: int("amountCents").default(0).notNull(),
  provider: varchar("provider", { length: 32 }).default("sandbox").notNull(),
  externalRef: varchar("externalRef", { length: 180 }),
  renewsAt: timestamp("renewsAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  invitedByUserId: int("invitedByUserId").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "manager", "professional", "viewer"]).default("viewer").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "expired", "revoked"]).default("pending").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var onboardingProgress = mysqlTable("onboardingProgress", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull().unique(),
  currentStep: int("currentStep").default(1).notNull(),
  status: mysqlEnum("status", ["not_started", "in_progress", "completed"]).default("not_started").notNull(),
  city: varchar("city", { length: 120 }),
  defaultUnitName: varchar("defaultUnitName", { length: 160 }),
  inviteEmail: varchar("inviteEmail", { length: 320 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  unitId: int("unitId"),
  action: varchar("action", { length: 64 }).notNull(),
  entity: varchar("entity", { length: 64 }).notNull(),
  entityId: int("entityId"),
  beforeJson: text("beforeJson"),
  afterJson: text("afterJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/db.ts
var _db = null;
var MODULES = ["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"];
var ROLES = ["owner", "admin", "manager", "professional", "viewer"];
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  const values = { openId: user.openId };
  const updateSet = {};
  const textFields = ["name", "email", "loginMethod"];
  textFields.forEach((field) => {
    if (user[field] !== void 0) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  if (user.lastSignedIn !== void 0) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== void 0) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  values.lastSignedIn ??= /* @__PURE__ */ new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function getOrganizationsForUser(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ organization: organizations, membership: memberships }).from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).orderBy(desc(organizations.updatedAt));
}
async function getMembership(userId, organizationId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select({ membership: memberships, organization: organizations }).from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId))).limit(1);
  return result[0];
}
async function createOrganizationWithOwner(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const limits = { starter: { maxUnits: 1, maxUsers: 12 }, growth: { maxUnits: 3, maxUsers: 32 }, scale: { maxUnits: 10, maxUsers: 100 } }[input.plan];
    const [created] = await tx.insert(organizations).values({ name: input.name, slug: input.slug, plan: input.plan, status: "trial", ...limits }).$returningId();
    const organizationId = created.id;
    const [unit] = await tx.insert(organizationUnits).values({ organizationId, name: input.name, slug: "sede-principal", status: "active" }).$returningId();
    await tx.insert(memberships).values({ organizationId, userId: input.userId, role: "owner", status: "active" });
    await tx.insert(subscriptions).values({ organizationId, plan: input.plan, status: "trialing", billingCycle: "monthly", provider: "sandbox", amountCents: input.plan === "starter" ? 39900 : input.plan === "growth" ? 79900 : 149e3 });
    await tx.insert(onboardingProgress).values({ organizationId, currentStep: 1, status: "in_progress", defaultUnitName: input.name });
    await tx.insert(modulePolicies).values(ROLES.flatMap((role) => MODULES.map((module) => ({ organizationId, unitId: unit.id, role, module, canView: role === "viewer" || role === "professional" || role === "manager" || role === "admin" || role === "owner" ? 1 : 0, canManage: role === "owner" || role === "admin" || role === "manager" && ["dashboard", "academias", "profissionais", "alunos", "agenda"].includes(module) ? 1 : 0 }))));
    return { organizationId, unitId: unit.id };
  });
}
async function createOrganizationInvitation(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(invitations).values(input).$returningId();
  return created;
}
async function getPendingOrganizationInvitations(organizationId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invitations).where(and(eq(invitations.organizationId, organizationId), eq(invitations.status, "pending"))).orderBy(desc(invitations.createdAt));
}
async function acceptOrganizationInvitation(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const result = await tx.select().from(invitations).where(and(eq(invitations.tokenHash, input.tokenHash), eq(invitations.status, "pending"))).limit(1);
    const invitation = result[0];
    if (!invitation) throw new Error("Invitation not found or already used");
    if (invitation.expiresAt < /* @__PURE__ */ new Date()) {
      await tx.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invitation.id));
      throw new Error("Invitation expired");
    }
    if (invitation.email.toLowerCase() !== input.email.toLowerCase()) throw new Error("Invitation email does not match the authenticated user");
    await tx.insert(memberships).values({ organizationId: invitation.organizationId, userId: input.userId, role: invitation.role, status: "active" }).onDuplicateKeyUpdate({ set: { role: invitation.role, status: "active" } });
    await tx.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invitation.id));
    return { invitation, organizationId: invitation.organizationId, role: invitation.role };
  });
}
async function getOrganizationSubscription(organizationId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  return result[0];
}
async function getOrganizationAccess(userId, organizationId) {
  const db = await getDb();
  if (!db) return void 0;
  const membership = await getMembership(userId, organizationId);
  if (!membership) return void 0;
  const units = await db.select().from(organizationUnits).where(and(eq(organizationUnits.organizationId, organizationId), eq(organizationUnits.status, "active")));
  const policies = await db.select().from(modulePolicies).where(eq(modulePolicies.organizationId, organizationId));
  return { organization: membership.organization, membership: membership.membership, units, policies };
}
async function saveOrganizationOnboarding(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    if (input.logoUrl !== void 0 || input.primaryColor !== void 0 || input.defaultUnitName !== void 0) {
      await tx.update(organizations).set({ ...input.logoUrl !== void 0 ? { logoUrl: input.logoUrl } : {}, ...input.primaryColor !== void 0 ? { primaryColor: input.primaryColor } : {}, ...input.defaultUnitName !== void 0 ? { name: input.defaultUnitName } : {} }).where(eq(organizations.id, input.organizationId));
    }
    await tx.insert(onboardingProgress).values({ organizationId: input.organizationId, currentStep: input.currentStep, status: input.status, city: input.city, defaultUnitName: input.defaultUnitName, inviteEmail: input.inviteEmail }).onDuplicateKeyUpdate({ set: { currentStep: input.currentStep, status: input.status, city: input.city, defaultUnitName: input.defaultUnitName, inviteEmail: input.inviteEmail } });
    return { organizationId: input.organizationId, saved: true };
  });
}
async function updateModulePolicy(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(modulePolicies).values(input).onDuplicateKeyUpdate({ set: { canView: input.canView, canManage: input.canManage } });
  return { saved: true };
}
async function getOrganizationOnboarding(organizationId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(onboardingProgress).where(eq(onboardingProgress.organizationId, organizationId)).limit(1);
  return result[0];
}
async function createOrganizationUnit(input) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(organizationUnits).values({ ...input, status: "active" }).$returningId();
  return created;
}
async function archiveOrganizationUnit(organizationId, unitId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(organizationUnits).set({ status: "archived" }).where(and(eq(organizationUnits.organizationId, organizationId), eq(organizationUnits.id, unitId)));
  return { organizationId, unitId, status: "archived" };
}
async function recordAuditLog(input) {
  const db = await getDb();
  if (!db) return void 0;
  const [created] = await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, unitId: input.unitId, action: input.action, entity: input.entity, entityId: input.entityId, beforeJson: input.beforeJson === void 0 ? void 0 : JSON.stringify(input.beforeJson), afterJson: input.afterJson === void 0 ? void 0 : JSON.stringify(input.afterJson) });
  return created;
}
async function getAuditLogs(organizationId, limit = 50, filters) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (filters?.from) conditions.push(gte(auditLogs.createdAt, filters.from));
  if (filters?.to) conditions.push(lte(auditLogs.createdAt, filters.to));
  if (filters?.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters?.entity && filters.entity !== "all") conditions.push(eq(auditLogs.entity, filters.entity));
  return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit);
}
function auditLogsToCsv(rows) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["id", "action", "entity", "entityId", "userId", "unitId", "createdAt"].join(","),
    ...rows.map((row) => [row.id, row.action, row.entity, row.entityId, row.userId, row.unitId, row.createdAt.toISOString()].map(escape).join(","))
  ].join("\n");
}
function auditLogsToPdfBase64(rows) {
  const sanitize = (value) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const lines = ["ARKE - Auditoria do tenant", "", ...rows.slice(0, 35).map((row) => `${row.createdAt.toISOString()} | ${row.action} | ${row.entity} | usu\xE1rio ${row.userId}`)];
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
import { randomUUID, createHash } from "node:crypto";
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
  const text2 = await response.text();
  return text2 ? JSON.parse(text2) : [];
}
var id = () => randomUUID();
var hash = (value) => createHash("sha256").update(value).digest("hex");
async function signInWithSupabase(email, password) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ email: normalizeEmail(email), password }) });
  if (!response.ok) throw new Error("Usu\xE1rio ou senha inv\xE1lidos.");
  const data = await response.json();
  return { accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user };
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
  await request("app_users", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  await notifyAdmins("Cadastro removido no Arke", `<p>O cadastro de usu\xE1rio <strong>${idValue}</strong> foi removido pela administra\xE7\xE3o.</p>`);
  return { id: idValue };
}
async function listAppStudents() {
  return request("app_students", {}, "?select=*&order=created_at.asc");
}
async function createAppStudent(input) {
  const rows = await request("app_students", { method: "POST", body: JSON.stringify({ id: id(), ...input }) });
  return rows[0];
}
async function updateAppStudent(idValue, input) {
  const rows = await request("app_students", { method: "PATCH", body: JSON.stringify({ ...input, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) }, `?id=eq.${encodeURIComponent(idValue)}`);
  return rows[0];
}
async function deleteAppStudent(idValue) {
  await request("app_students", { method: "DELETE" }, `?id=eq.${encodeURIComponent(idValue)}`);
  return { id: idValue };
}
async function createPasswordRecovery(email) {
  const token = id();
  await request("app_password_resets", { method: "POST", body: JSON.stringify({ id: id(), email: email.toLowerCase(), token_hash: hash(token), expires_at: new Date(Date.now() + 36e5).toISOString() }) });
  await sendEmail(email, "Recupera\xE7\xE3o de senha \u2014 Arke", `<p>Recebemos uma solicita\xE7\xE3o de recupera\xE7\xE3o de senha.</p><p>Use este c\xF3digo tempor\xE1rio no portal Arke:</p><h2>${token}</h2><p>Este c\xF3digo expira em 1 hora.</p>`);
  return { sent: true };
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
  const text2 = await response.text();
  return text2 ? JSON.parse(text2) : [];
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
var organizationIdInput = z2.object({ organizationId: z2.number().int().positive() });
var moduleName = z2.enum(["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"]);
var roleName = z2.enum(["owner", "admin", "manager", "professional", "viewer"]);
var auditFilterInput = z2.object({ organizationId: z2.number().int().positive(), from: z2.string().optional(), to: z2.string().optional(), userId: z2.number().int().positive().optional(), entity: z2.string().max(64).optional() });
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
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),
    signIn: publicProcedure.input(z2.object({ email: z2.string().email(), password: z2.string().min(8) })).mutation(({ input }) => signInWithSupabase(input.email, input.password)),
    recoverPassword: publicProcedure.input(z2.object({ email: z2.string().email() })).mutation(({ input }) => createPasswordRecovery(normalizeEmail(input.email)))
  }),
  admin: router({
    status: publicProcedure.query(() => ({ configured: hasSupabaseConfig() })),
    lookupCnpj: publicProcedure.input(z2.object({ cnpj: z2.string().min(14).max(18) })).mutation(({ input }) => lookupCnpj(input.cnpj)),
    users: router({
      list: publicProcedure.query(() => listAppUsers()),
      create: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2).max(80), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable() })).mutation(({ input }) => createAppUser({ ...input, email: normalizeEmail(input.email) })),
      update: publicProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), username: z2.string().trim().min(2), module: z2.enum(["academia", "studio", "profissional", "aluno", "administrador"]), role: z2.string().trim().min(2), status: z2.enum(["Ativo", "Suspenso"]), logoUrl: z2.string().max(1e6).optional().nullable() }) })).mutation(({ input }) => updateAppUser(input.id, { ...input.data, email: normalizeEmail(input.data.email) })),
      delete: publicProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppUser(input.id))
    }),
    students: router({
      list: publicProcedure.query(() => listAppStudents()),
      create: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) })).mutation(({ input }) => createAppStudent(input)),
      update: publicProcedure.input(z2.object({ id: z2.string().uuid(), data: z2.object({ name: z2.string().trim().min(2), academy: z2.string().trim().min(2), plan: z2.string().trim().min(2), status: z2.enum(["Ativo", "Inativo"]) }) })).mutation(({ input }) => updateAppStudent(input.id, input.data)),
      delete: publicProcedure.input(z2.object({ id: z2.string().uuid() })).mutation(({ input }) => deleteAppStudent(input.id))
    })
  }),
  billing: router({
    asaasStatus: publicProcedure.query(() => ({ configured: asaasSandboxConfigured(), environment: "sandbox" })),
    asaasAccount: publicProcedure.query(() => getAsaasAccount()),
    asaasPayments: publicProcedure.input(z2.object({ limit: z2.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listAsaasPayments(input?.limit ?? 20)),
    asaasStoredPayments: publicProcedure.input(z2.object({ limit: z2.number().int().min(1).max(100).optional() }).optional()).query(({ input }) => listStoredAsaasPayments(input?.limit ?? 20)),
    createAsaasCustomer: publicProcedure.input(z2.object({ name: z2.string().trim().min(2), email: z2.string().email(), cpfCnpj: z2.string().trim().optional() })).mutation(({ input }) => createAsaasCustomer(input)),
    createAsaasPayment: publicProcedure.input(z2.object({ customer: z2.string().min(2), value: z2.number().positive(), dueDate: z2.string(), billingType: z2.enum(["PIX", "BOLETO", "CREDIT_CARD"]), description: z2.string().trim().min(2) })).mutation(({ input }) => createAsaasPayment(input)),
    createAsaasWebhook: publicProcedure.input(z2.object({ url: z2.string().url(), email: z2.string().email() })).mutation(({ input }) => createAsaasWebhook(input))
  }),
  saas: router({
    organizations: router({
      list: protectedProcedure.query(({ ctx }) => getOrganizationsForUser(ctx.user.id)),
      create: protectedProcedure.input(z2.object({ name: z2.string().trim().min(2).max(160), slug: z2.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), plan: z2.enum(["starter", "growth", "scale"]) })).mutation(({ ctx, input }) => createOrganizationWithOwner({ userId: ctx.user.id, ...input })),
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
      createUnit: protectedProcedure.input(z2.object({ organizationId: z2.number().int().positive(), name: z2.string().trim().min(2).max(160), slug: z2.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120), city: z2.string().trim().max(120).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const unit = await createOrganizationUnit(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: unit.id, action: "created", entity: "organization_unit", entityId: unit.id, afterJson: input });
        return unit;
      }),
      archiveUnit: protectedProcedure.input(z2.object({ organizationId: z2.number().int().positive(), unitId: z2.number().int().positive() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await archiveOrganizationUnit(input.organizationId, input.unitId);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "archived", entity: "organization_unit", entityId: input.unitId, afterJson: result });
        return result;
      }),
      subscription: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return getOrganizationSubscription(input.organizationId);
      }),
      onboarding: protectedProcedure.input(organizationIdInput).query(async ({ ctx, input }) => {
        await hasOrganizationAccess(ctx.user.id, input.organizationId);
        return getOrganizationOnboarding(input.organizationId);
      }),
      saveOnboarding: protectedProcedure.input(z2.object({ organizationId: z2.number().int().positive(), currentStep: z2.number().int().min(1).max(4), status: z2.enum(["not_started", "in_progress", "completed"]), city: z2.string().trim().max(120).optional(), defaultUnitName: z2.string().trim().min(2).max(160).optional(), inviteEmail: z2.string().email().optional(), logoUrl: z2.string().url().max(512).optional(), primaryColor: z2.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await saveOrganizationOnboarding(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "updated", entity: "onboarding_branding", afterJson: input });
        return result;
      }),
      updatePolicy: protectedProcedure.input(z2.object({ organizationId: z2.number().int().positive(), unitId: z2.number().int().positive(), role: roleName, module: moduleName, canView: z2.number().int().min(0).max(1), canManage: z2.number().int().min(0).max(1) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const result = await updateModulePolicy(input);
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, unitId: input.unitId, action: "updated", entity: "module_policy", afterJson: input });
        return result;
      }),
      invite: protectedProcedure.input(z2.object({ organizationId: z2.number().int().positive(), email: z2.string().email(), role: z2.enum(["admin", "manager", "professional", "viewer"]) })).mutation(async ({ ctx, input }) => {
        await ownerOrAdmin(ctx.user.id, input.organizationId);
        const rawToken = randomUUID2();
        const tokenHash = createHash2("sha256").update(rawToken).digest("hex");
        const invitation = await createOrganizationInvitation({ ...input, invitedByUserId: ctx.user.id, email: input.email.toLowerCase(), tokenHash, expiresAt: new Date(Date.now() + 1e3 * 60 * 60 * 72) });
        await recordAuditLog({ organizationId: input.organizationId, userId: ctx.user.id, action: "created", entity: "invitation", entityId: invitation.id, afterJson: { email: input.email.toLowerCase(), role: input.role } });
        return { invitationId: invitation.id, token: rawToken, status: "pending" };
      }),
      acceptInvite: protectedProcedure.input(z2.object({ token: z2.string().min(16).max(128) })).mutation(async ({ ctx, input }) => {
        if (!ctx.user.email) throw new Error("Authenticated user email is required");
        const result = await acceptOrganizationInvitation({ tokenHash: createHash2("sha256").update(input.token).digest("hex"), userId: ctx.user.id, email: ctx.user.email });
        await recordAuditLog({ organizationId: result.organizationId, userId: ctx.user.id, action: "accepted", entity: "invitation", entityId: result.invitation.id, afterJson: { role: result.role, email: ctx.user.email } });
        return { organizationId: result.organizationId, role: result.role, status: "accepted" };
      })
    })
  })
});

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString2 = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString2(openId) || !isNonEmptyString2(appId) || !isNonEmptyString2(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
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
    const unitId = normalize(body.unitId);
    const studentId = normalize(body.studentId);
    const document = normalize(body.document);
    const deviceId = normalize(body.deviceId) || "demo-gate-01";
    const provider = body.provider ?? "arke_demo";
    if (!academyId || !studentId && !document) {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "academyId e studentId ou document s\xE3o obrigat\xF3rios." });
    }
    const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
    const eventId = `access_${randomUUID3()}`;
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

// serverless/entry.ts
function createApp() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerAccessRoutes(app);
  registerAsaasWebhook(app);
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

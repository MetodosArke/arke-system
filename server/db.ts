import { and, desc, eq, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { ENV } from "./_core/env";
import { InsertUser, auditLogs, invitations, memberships, modulePolicies, onboardingProgress, organizationUnits, organizations, subscriptions, users } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;
const MODULES = ["dashboard", "academias", "profissionais", "alunos", "agenda", "financeiro", "integracoes"] as const;
const ROLES = ["owner", "admin", "manager", "professional", "viewer"] as const;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach((field) => { if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; } });
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  values.lastSignedIn ??= new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOrganizationsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ organization: organizations, membership: memberships }).from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).orderBy(desc(organizations.updatedAt));
}

export async function getMembership(userId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ membership: memberships, organization: organizations }).from(memberships).innerJoin(organizations, eq(memberships.organizationId, organizations.id)).where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId))).limit(1);
  return result[0];
}

export async function createOrganizationWithOwner(input: { userId: number; clientId: string; name: string; slug: string; plan: "starter" | "growth" | "scale" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.clientId, input.clientId), eq(organizations.status, "active"))).limit(1);
    const trial = await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.clientId, input.clientId), eq(organizations.status, "trial"))).limit(1);
    if (existing[0] || trial[0]) throw new Error(`O cliente já possui uma licença ativa: ${(existing[0] ?? trial[0]).name}`);
    const limits = { starter: { maxUnits: 1, maxUsers: 12 }, growth: { maxUnits: 3, maxUsers: 32 }, scale: { maxUnits: 10, maxUsers: 100 } }[input.plan];
    const [created] = await tx.insert(organizations).values({ clientId: input.clientId, name: input.name, slug: input.slug, plan: input.plan, status: "trial", reconciliationStatus: "matched", reconciliationNote: "Vinculada ao cliente selecionado no onboarding", ...limits }).$returningId();
    const organizationId = created.id;
    const [unit] = await tx.insert(organizationUnits).values({ organizationId, name: input.name, slug: "sede-principal", status: "active" }).$returningId();
    await tx.insert(memberships).values({ organizationId, userId: input.userId, role: "owner", status: "active" });
    await tx.insert(subscriptions).values({ organizationId, plan: input.plan, status: "trialing", billingCycle: "monthly", provider: "sandbox", amountCents: input.plan === "starter" ? 39900 : input.plan === "growth" ? 79900 : 149000 });
    await tx.insert(onboardingProgress).values({ organizationId, currentStep: 1, status: "in_progress", defaultUnitName: input.name });
    await tx.insert(modulePolicies).values(ROLES.flatMap((role) => MODULES.map((module) => ({ organizationId, unitId: unit.id, role, module, canView: role === "viewer" || role === "professional" || role === "manager" || role === "admin" || role === "owner" ? 1 : 0, canManage: role === "owner" || role === "admin" || (role === "manager" && ["dashboard", "academias", "profissionais", "alunos", "agenda"].includes(module)) ? 1 : 0 }))));
    return { organizationId, unitId: unit.id };
  });
}

export async function createOrganizationInvitation(input: { organizationId: number; invitedByUserId: number; email: string; role: "admin" | "manager" | "professional" | "viewer"; tokenHash: string; expiresAt: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(invitations).values(input).$returningId();
  return created;
}

export async function getPendingOrganizationInvitations(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invitations).where(and(eq(invitations.organizationId, organizationId), eq(invitations.status, "pending"))).orderBy(desc(invitations.createdAt));
}

export async function acceptOrganizationInvitation(input: { tokenHash: string; userId: number; email: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const result = await tx.select().from(invitations).where(and(eq(invitations.tokenHash, input.tokenHash), eq(invitations.status, "pending"))).limit(1);
    const invitation = result[0];
    if (!invitation) throw new Error("Invitation not found or already used");
    if (invitation.expiresAt < new Date()) {
      await tx.update(invitations).set({ status: "expired" }).where(eq(invitations.id, invitation.id));
      throw new Error("Invitation expired");
    }
    if (invitation.email.toLowerCase() !== input.email.toLowerCase()) throw new Error("Invitation email does not match the authenticated user");
    await tx.insert(memberships).values({ organizationId: invitation.organizationId, userId: input.userId, role: invitation.role, status: "active" }).onDuplicateKeyUpdate({ set: { role: invitation.role, status: "active" } });
    await tx.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invitation.id));
    return { invitation, organizationId: invitation.organizationId, role: invitation.role };
  });
}

export async function getOrganizationSubscription(organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).orderBy(desc(subscriptions.createdAt)).limit(1);
  return result[0];
}

export async function updateOrganizationProfile(input: { organizationId: number; name: string; logoUrl?: string; primaryColor?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(organizations).set({ name: input.name, ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}), ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}) }).where(eq(organizations.id, input.organizationId));
  return getMembership((await getMembershipByOrganizationOwner(input.organizationId)) ?? 0, input.organizationId);
}

async function getMembershipByOrganizationOwner(organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.role, "owner"))).limit(1);
  return result[0]?.userId;
}

export async function updateOrganizationSubscription(input: { organizationId: number; plan: "starter" | "growth" | "scale"; status?: "trialing" | "active" | "past_due" | "canceled" }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const amountCents = { starter: 39900, growth: 79900, scale: 149000 }[input.plan];
  await db.update(organizations).set({ plan: input.plan, maxUnits: { starter: 1, growth: 3, scale: 10 }[input.plan], maxUsers: { starter: 12, growth: 32, scale: 100 }[input.plan] }).where(eq(organizations.id, input.organizationId));
  await db.update(subscriptions).set({ plan: input.plan, amountCents, ...(input.status ? { status: input.status } : {}) }).where(eq(subscriptions.organizationId, input.organizationId));
  return getOrganizationSubscription(input.organizationId);
}

export async function getOrganizationAccess(userId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const membership = await getMembership(userId, organizationId);
  if (!membership) return undefined;
  const units = await db.select().from(organizationUnits).where(and(eq(organizationUnits.organizationId, organizationId), eq(organizationUnits.status, "active")));
  const policies = await db.select().from(modulePolicies).where(eq(modulePolicies.organizationId, organizationId));
  return { organization: membership.organization, membership: membership.membership, units, policies };
}

export async function saveOrganizationOnboarding(input: { organizationId: number; currentStep: number; status: "not_started" | "in_progress" | "completed"; city?: string; defaultUnitName?: string; inviteEmail?: string; logoUrl?: string; primaryColor?: string; }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    if (input.logoUrl !== undefined || input.primaryColor !== undefined || input.defaultUnitName !== undefined) {
      await tx.update(organizations).set({ ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}), ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor } : {}), ...(input.defaultUnitName !== undefined ? { name: input.defaultUnitName } : {}) }).where(eq(organizations.id, input.organizationId));
    }
    await tx.insert(onboardingProgress).values({ organizationId: input.organizationId, currentStep: input.currentStep, status: input.status, city: input.city, defaultUnitName: input.defaultUnitName, inviteEmail: input.inviteEmail }).onDuplicateKeyUpdate({ set: { currentStep: input.currentStep, status: input.status, city: input.city, defaultUnitName: input.defaultUnitName, inviteEmail: input.inviteEmail } });
    return { organizationId: input.organizationId, saved: true };
  });
}

export async function updateModulePolicy(input: { organizationId: number; unitId: number; role: "owner" | "admin" | "manager" | "professional" | "viewer"; module: string; canView: number; canManage: number; }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(modulePolicies).values(input).onDuplicateKeyUpdate({ set: { canView: input.canView, canManage: input.canManage } });
  return { saved: true };
}

export async function getOrganizationOnboarding(organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(onboardingProgress).where(eq(onboardingProgress.organizationId, organizationId)).limit(1);
  return result[0];
}

export async function createOrganizationUnit(input: { organizationId: number; name: string; slug: string; city?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db.insert(organizationUnits).values({ ...input, status: "active" }).$returningId();
  return created;
}

export async function archiveOrganizationUnit(organizationId: number, unitId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(organizationUnits).set({ status: "archived" }).where(and(eq(organizationUnits.organizationId, organizationId), eq(organizationUnits.id, unitId)));
  return { organizationId, unitId, status: "archived" as const };
}

export async function recordAuditLog(input: { organizationId: number; userId: number; unitId?: number; action: string; entity: string; entityId?: number; beforeJson?: unknown; afterJson?: unknown }) {
  const db = await getDb();
  if (!db) return undefined;
  const [created] = await db.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.userId, unitId: input.unitId, action: input.action, entity: input.entity, entityId: input.entityId, beforeJson: input.beforeJson === undefined ? undefined : JSON.stringify(input.beforeJson), afterJson: input.afterJson === undefined ? undefined : JSON.stringify(input.afterJson) });
  return created;
}

export async function getAuditLogs(organizationId: number, limit = 50, filters?: { from?: Date; to?: Date; userId?: number; entity?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(auditLogs.organizationId, organizationId)];
  if (filters?.from) conditions.push(gte(auditLogs.createdAt, filters.from));
  if (filters?.to) conditions.push(lte(auditLogs.createdAt, filters.to));
  if (filters?.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters?.entity && filters.entity !== "all") conditions.push(eq(auditLogs.entity, filters.entity));
  return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

export function auditLogsToCsv(rows: Array<{ id: number; action: string; entity: string; entityId: number | null; userId: number; unitId: number | null; createdAt: Date }>) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["id", "action", "entity", "entityId", "userId", "unitId", "createdAt"].join(","),
    ...rows.map((row) => [row.id, row.action, row.entity, row.entityId, row.userId, row.unitId, row.createdAt.toISOString()].map(escape).join(",")),
  ].join("\n");
}

export function auditLogsToPdfBase64(rows: Array<{ id: number; action: string; entity: string; entityId: number | null; userId: number; unitId: number | null; createdAt: Date }>) {
  const sanitize = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const lines = ["ARKE - Auditoria do tenant", "", ...rows.slice(0, 35).map((row) => `${row.createdAt.toISOString()} | ${row.action} | ${row.entity} | usuário ${row.userId}`)];
  const content = ["BT", "/F1 9 Tf", "50 800 Td", ...lines.flatMap((line, index) => [index === 0 ? `(${sanitize(line)}) Tj` : "0 -18 Td", index === 0 ? "" : `(${sanitize(line)}) Tj`]), "ET"].join("\n");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets[index + 1] = Buffer.byteLength(pdf, "utf8"); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "utf8");
  const entries = offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n ").join("\n");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8").toString("base64");
}

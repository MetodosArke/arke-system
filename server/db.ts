// Núcleo SaaS (organizations/units/memberships/subscriptions/module_policies/
// onboarding/audit_logs) falando com Supabase via REST + service_role, no
// mesmo padrão de server/supabaseAdmin.ts. As tabelas-alvo (saas_*) e a RLS
// que as protege estão em supabase/20260914_core_schema_target.sql,
// supabase/20260914_core_rls_policies.sql e supabase/20260914_organization_rpcs.sql.
//
// Identidade: userId é o uuid de auth.users (Supabase Auth), não mais o
// inteiro espelhado do antigo `users` do Drizzle/TiDB — não há mais tabela
// de usuário própria aqui, auth.users já é a fonte de verdade.

type Json = Record<string, unknown>;

function isConfigured() {
  return Boolean((process.env.SUPABASE_URL ?? "") && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? ""));
}

function config() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
  if (!url || !key) throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return { url: url.replace(/\/$/, ""), key };
}

async function request<T>(table: string, init: RequestInit = {}, query = "") {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

async function rpc<T>(fn: string, args: Json) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`Supabase RPC ${fn} ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export type Organization = {
  id: string; client_id: string; name: string; slug: string;
  plan: "starter" | "growth" | "scale" | "unlimited" | "essencial" | "performance" | "premium";
  status: "trial" | "active" | "past_due" | "canceled";
  module: string; logo_url: string | null; primary_color: string | null;
  max_units: number; max_users: number;
  reconciliation_status: "matched" | "review"; reconciliation_note: string | null;
  full_service_enabled: boolean;
  created_at: string; updated_at: string;
};
export type Membership = {
  id: string; organization_id: string; auth_user_id: string;
  role: "owner" | "admin" | "manager" | "professional" | "nutricionista" | "viewer";
  status: "active" | "invited" | "suspended";
  created_at: string;
};
export type OrganizationUnit = { id: string; organization_id: string; name: string; slug: string; city: string | null; status: "active" | "archived"; created_at: string };
export type ModulePolicy = { id: string; organization_id: string; unit_id: string; role: Membership["role"]; module: string; can_view: boolean; can_manage: boolean };
export type Subscription = { id: string; organization_id: string; plan: Organization["plan"]; status: "trialing" | "active" | "past_due" | "canceled"; billing_cycle: "monthly" | "yearly"; amount_cents: number; provider: string; external_id: string | null; created_at: string; updated_at: string };
export type Invitation = { id: string; organization_id: string; invited_by_user_id: string; email: string; role: "admin" | "manager" | "professional" | "nutricionista" | "viewer"; status: "pending" | "accepted" | "expired" | "revoked"; token_hash: string; expires_at: string; created_at: string };
export type OnboardingProgress = { id: string; organization_id: string; current_step: number; status: "not_started" | "in_progress" | "completed"; city: string | null; default_unit_name: string | null; invite_email: string | null; created_at: string; updated_at: string };
export type AuditLog = { id: string; organization_id: string; auth_user_id: string | null; action: string; entity: string; entity_id: string | null; before_json: unknown; after_json: unknown; created_at: string };

const PLAN_LIMITS = { starter: { maxUnits: 1, maxUsers: 12 }, growth: { maxUnits: 3, maxUsers: 32 }, scale: { maxUnits: 10, maxUsers: 100 }, unlimited: { maxUnits: 999, maxUsers: 99999 }, essencial: { maxUnits: 1, maxUsers: 3 }, performance: { maxUnits: 1, maxUsers: 8 }, premium: { maxUnits: 1, maxUsers: 20 } } as const;
const PLAN_AMOUNTS = { starter: 39900, growth: 79900, scale: 149000, unlimited: 349000, essencial: 14900, performance: 24900, premium: 19900 } as const;

export async function getOrganizationsForUser(userId: string) {
  if (!isConfigured()) return [];
  const rows = await request<Array<Membership & { saas_organizations: Organization }>>(
    "saas_memberships",
    {},
    `?select=*,saas_organizations(*)&auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.active`,
  );
  return rows
    .map(({ saas_organizations, ...membership }) => ({ membership, organization: saas_organizations }))
    .sort((a, b) => b.organization.updated_at.localeCompare(a.organization.updated_at));
}

export async function getMembership(userId: string, organizationId: string) {
  if (!isConfigured()) return undefined;
  const rows = await request<Array<Membership & { saas_organizations: Organization }>>(
    "saas_memberships",
    {},
    `?select=*,saas_organizations(*)&auth_user_id=eq.${encodeURIComponent(userId)}&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return undefined;
  const { saas_organizations, ...membership } = row;
  return { membership, organization: saas_organizations };
}

export type OrganizationBranding = { id: string; name: string; slug: string; module: string; logo_url: string | null; primary_color: string | null };

export async function getOrganizationBySlug(slug: string) {
  if (!isConfigured()) return undefined;
  const rows = await request<OrganizationBranding[]>("saas_organizations", {}, `?select=id,name,slug,module,logo_url,primary_color&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0];
}

export async function createOrganizationWithOwner(input: { userId: string; clientId: string; name: string; slug: string; plan: Organization["plan"]; module?: string; logoUrl?: string; primaryColor?: string }) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc<Array<{ organization_id: string; unit_id: string }>>("create_organization_with_owner", {
    p_user_id: input.userId,
    p_client_id: input.clientId,
    p_name: input.name,
    p_slug: input.slug,
    p_plan: input.plan,
    p_module: input.module ?? "academia",
    p_logo_url: input.logoUrl ?? null,
    p_primary_color: input.primaryColor ?? null,
  });
  if (!result) throw new Error("Falha ao criar organização");
  return { organizationId: result.organization_id, unitId: result.unit_id };
}

export async function createOrganizationInvitation(input: { organizationId: string; invitedByUserId: string; email: string; role: Invitation["role"]; tokenHash: string; expiresAt: Date }) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request<Invitation[]>("saas_invitations", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, invited_by_user_id: input.invitedByUserId, email: input.email, role: input.role, token_hash: input.tokenHash, expires_at: input.expiresAt.toISOString() }) });
  return created;
}

export async function getPendingOrganizationInvitations(organizationId: string) {
  if (!isConfigured()) return [];
  return request<Invitation[]>("saas_invitations", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending&order=created_at.desc`);
}

export async function revokeOrganizationInvitation(id: string, organizationId: string) {
  if (!isConfigured()) throw new Error("Database not available");
  const rows = await request<Invitation[]>("saas_invitations", { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }, `?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.pending`);
  if (!rows[0]) throw new Error("Convite não encontrado ou já utilizado.");
  return rows[0];
}

export async function acceptOrganizationInvitation(input: { tokenHash: string; userId: string; email: string }) {
  if (!isConfigured()) throw new Error("Database not available");
  const [result] = await rpc<Array<{ org_id: string; role: Invitation["role"]; invitation_id: string }>>("accept_organization_invitation", {
    p_token_hash: input.tokenHash,
    p_user_id: input.userId,
    p_email: input.email,
  });
  if (!result) throw new Error("Invitation not found or already used");
  return { invitation: { id: result.invitation_id }, organizationId: result.org_id, role: result.role };
}

export async function getOrganizationSubscription(organizationId: string) {
  if (!isConfigured()) return undefined;
  const rows = await request<Subscription[]>("saas_subscriptions", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&order=created_at.desc&limit=1`);
  return rows[0];
}

export async function updateOrganizationProfile(input: { organizationId: string; name: string; logoUrl?: string; primaryColor?: string }) {
  if (!isConfigured()) throw new Error("Database not available");
  const [updated] = await request<Organization[]>("saas_organizations", { method: "PATCH", body: JSON.stringify({ name: input.name, ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}), ...(input.primaryColor !== undefined ? { primary_color: input.primaryColor } : {}) }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  return updated;
}

export async function updateOrganizationSubscription(input: { organizationId: string; plan: Organization["plan"]; status?: Subscription["status"] }) {
  if (!isConfigured()) throw new Error("Database not available");
  const amountCents = PLAN_AMOUNTS[input.plan];
  const limits = PLAN_LIMITS[input.plan];
  await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ plan: input.plan, max_units: limits.maxUnits, max_users: limits.maxUsers }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  await request("saas_subscriptions", { method: "PATCH", body: JSON.stringify({ plan: input.plan, amount_cents: amountCents, ...(input.status ? { status: input.status } : {}) }) }, `?organization_id=eq.${encodeURIComponent(input.organizationId)}`);
  return getOrganizationSubscription(input.organizationId);
}

export async function getOrganizationAccess(userId: string, organizationId: string) {
  if (!isConfigured()) return undefined;
  const membership = await getMembership(userId, organizationId);
  if (!membership) return undefined;
  const [units, policies] = await Promise.all([
    request<OrganizationUnit[]>("saas_units", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&status=eq.active`),
    request<ModulePolicy[]>("saas_module_policies", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}`),
  ]);
  return { organization: membership.organization, membership: membership.membership, units, policies };
}

export async function saveOrganizationOnboarding(input: { organizationId: string; currentStep: number; status: OnboardingProgress["status"]; city?: string; defaultUnitName?: string; inviteEmail?: string; logoUrl?: string; primaryColor?: string }) {
  if (!isConfigured()) throw new Error("Database not available");
  if (input.logoUrl !== undefined || input.primaryColor !== undefined || input.defaultUnitName !== undefined) {
    await request("saas_organizations", { method: "PATCH", body: JSON.stringify({ ...(input.logoUrl !== undefined ? { logo_url: input.logoUrl } : {}), ...(input.primaryColor !== undefined ? { primary_color: input.primaryColor } : {}), ...(input.defaultUnitName !== undefined ? { name: input.defaultUnitName } : {}) }) }, `?id=eq.${encodeURIComponent(input.organizationId)}`);
  }
  await request("saas_onboarding", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, current_step: input.currentStep, status: input.status, city: input.city ?? null, default_unit_name: input.defaultUnitName ?? null, invite_email: input.inviteEmail ?? null }) }, "?on_conflict=organization_id");
  return { organizationId: input.organizationId, saved: true };
}

export async function updateModulePolicy(input: { organizationId: string; unitId: string; role: Membership["role"]; module: string; canView: boolean; canManage: boolean }) {
  if (!isConfigured()) throw new Error("Database not available");
  await request("saas_module_policies", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ organization_id: input.organizationId, unit_id: input.unitId, role: input.role, module: input.module, can_view: input.canView, can_manage: input.canManage }) }, "?on_conflict=organization_id,unit_id,role,module");
  return { saved: true };
}

export async function getOrganizationOnboarding(organizationId: string) {
  if (!isConfigured()) return undefined;
  const rows = await request<OnboardingProgress[]>("saas_onboarding", {}, `?select=*&organization_id=eq.${encodeURIComponent(organizationId)}&limit=1`);
  return rows[0];
}

export async function createOrganizationUnit(input: { organizationId: string; name: string; slug: string; city?: string }) {
  if (!isConfigured()) throw new Error("Database not available");
  const [created] = await request<OrganizationUnit[]>("saas_units", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, name: input.name, slug: input.slug, city: input.city ?? null, status: "active" }) });
  return created;
}

export async function archiveOrganizationUnit(organizationId: string, unitId: string) {
  if (!isConfigured()) throw new Error("Database not available");
  await request("saas_units", { method: "PATCH", body: JSON.stringify({ status: "archived" }) }, `?organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(unitId)}`);
  return { organizationId, unitId, status: "archived" as const };
}

export async function recordAuditLog(input: { organizationId: string; userId: string; unitId?: string; action: string; entity: string; entityId?: string; beforeJson?: unknown; afterJson?: unknown }) {
  if (!isConfigured()) return undefined;
  const [created] = await request<AuditLog[]>("saas_audit_logs", { method: "POST", body: JSON.stringify({ organization_id: input.organizationId, auth_user_id: input.userId, action: input.action, entity: input.entity, entity_id: input.entityId ?? null, before_json: input.beforeJson ?? null, after_json: input.afterJson ?? null }) });
  return created;
}

export async function getAuditLogs(organizationId: string, limit = 50, filters?: { from?: Date; to?: Date; userId?: string; entity?: string }) {
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
  return request<AuditLog[]>("saas_audit_logs", {}, `?${params.toString()}`);
}

export function auditLogsToCsv(rows: Array<{ id: string; action: string; entity: string; entity_id: string | null; auth_user_id: string | null; created_at: string }>) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    ["id", "action", "entity", "entityId", "userId", "createdAt"].join(","),
    ...rows.map((row) => [row.id, row.action, row.entity, row.entity_id, row.auth_user_id, row.created_at].map(escape).join(",")),
  ].join("\n");
}

export function auditLogsToPdfBase64(rows: Array<{ id: string; action: string; entity: string; auth_user_id: string | null; created_at: string }>) {
  const sanitize = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const lines = ["ARKE - Auditoria do tenant", "", ...rows.slice(0, 35).map((row) => `${row.created_at} | ${row.action} | ${row.entity} | usuário ${row.auth_user_id ?? "-"}`)];
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

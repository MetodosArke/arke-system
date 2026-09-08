import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { auditLogsToCsv, auditLogsToPdfBase64, getAuditLogs } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "saas-test-user",
    email: "saas@example.com",
    name: "SaaS Test",
    loginMethod: "test",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("saas.organizations", () => {
  it("returns an organization list through the protected tenant boundary", async () => {
    const result = await appRouter.createCaller(createContext()).saas.organizations.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("rejects a workspace slug that could break tenant routing", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.create({
      name: "Nova Academia",
      slug: "Nova Academia/../../other-tenant",
      plan: "growth",
    })).rejects.toThrow();
  });

  it("rejects policy values outside the explicit access boundary", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.updatePolicy({
      organizationId: 1,
      unitId: 1,
      role: "manager",
      module: "financeiro",
      canView: 2,
      canManage: 0,
    })).rejects.toThrow();
  });

  it("blocks audit history when the user is not a member of the organization", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.audit({ organizationId: 1 })).rejects.toThrow("Organization access denied");
  });

  it("validates invite tokens and produces downloadable audit formats", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.acceptInvite({ token: "short" })).rejects.toThrow();
    const rows = [{ id: 1, action: "updated", entity: "module_policy", entityId: 4, userId: 1, unitId: 2, createdAt: new Date("2026-09-05T12:00:00Z") }];
    expect(auditLogsToCsv(rows)).toContain("module_policy");
    expect(Buffer.from(auditLogsToPdfBase64(rows), "base64").subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  it("accepts the combined audit filter shape", async () => {
    const result = await getAuditLogs(1, 10, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z"), userId: 1, entity: "module_policy" });
    expect(Array.isArray(result)).toBe(true);
  });
});

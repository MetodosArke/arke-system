import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { auditLogsToCsv, auditLogsToPdfBase64, chargeSetupFeeIfNeeded, getAuditLogs } from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const TEST_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const TEST_ORG_ID = "00000000-0000-4000-8000-0000000000b1";

function createContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: TEST_USER_ID,
    email: "saas@example.com",
    name: "SaaS Test",
    role: "admin",
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
      organizationId: TEST_ORG_ID,
      unitId: TEST_ORG_ID,
      // @ts-expect-error role fora do enum aceito, exatamente o que este teste verifica
      role: "superuser",
      module: "financeiro",
      canView: true,
      canManage: false,
    })).rejects.toThrow();
  });

  it("blocks audit history when the user is not a member of the organization", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.audit({ organizationId: TEST_ORG_ID })).rejects.toThrow("Organization access denied");
  });

  it("validates invite tokens and produces downloadable audit formats", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.acceptInvite({ token: "short" })).rejects.toThrow();
    const rows = [{ id: "00000000-0000-0000-0000-0000000000c1", action: "updated", entity: "module_policy", entity_id: TEST_ORG_ID, auth_user_id: TEST_USER_ID, created_at: "2026-09-05T12:00:00Z" }];
    expect(auditLogsToCsv(rows)).toContain("module_policy");
    expect(Buffer.from(auditLogsToPdfBase64(rows), "base64").subarray(0, 8).toString()).toBe("%PDF-1.4");
  });

  it("accepts the combined audit filter shape", async () => {
    const result = await getAuditLogs(TEST_ORG_ID, 10, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z"), userId: TEST_USER_ID, entity: "module_policy" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("never throws when charging the setup fee (no-ops without Supabase configured)", async () => {
    await expect(chargeSetupFeeIfNeeded(TEST_ORG_ID)).resolves.toBeUndefined();
  });
});

describe("saas.organizations.arkeModule", () => {
  it("rejects a plan value outside the accepted enum on organization creation", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.create({
      name: "Nova Academia",
      slug: "nova-academia",
      // @ts-expect-error plano antigo removido nas regras comerciais, exatamente o que este teste verifica
      plan: "unlimited",
    })).rejects.toThrow();
  });

  it("requires organization access to read the arke module status", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.arkeModule({ organizationId: TEST_ORG_ID })).rejects.toThrow();
  });

  it("requires owner/admin to update the arke module", async () => {
    await expect(appRouter.createCaller(createContext()).saas.organizations.updateArkeModule({ organizationId: TEST_ORG_ID, enabled: true })).rejects.toThrow();
  });
});

describe("arke.membership", () => {
  it("requires staff access to the aluno's organization to read status", async () => {
    await expect(appRouter.createCaller(createContext()).arke.membership.status({ alunoId: TEST_USER_ID })).rejects.toThrow();
  });

  it("requires staff access to the aluno's organization to toggle", async () => {
    await expect(appRouter.createCaller(createContext()).arke.membership.toggle({ alunoId: TEST_USER_ID, ativo: true })).rejects.toThrow();
  });
});

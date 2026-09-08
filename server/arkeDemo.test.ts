import { describe, expect, it } from "vitest";
import { DEMO_CLIENTS, DEMO_MODULE_CLIENTS, DEMO_MODULE_USERS, DEMO_PASSWORD, DEMO_USERS, DEMO_TENANTS, MODULE_PERMISSIONS, SAAS_PLANS, getDemoUser, getModuleDemoUser, hasModuleDemoAccounts, hasTwoDemoClientsPerModule, hasValidSaaSDemoCatalog } from "../client/src/lib/arkeDemo";

describe("Arke demo seed", () => {
  it("defines both requested super logins as super admins with hashed credentials", () => {
    expect(DEMO_USERS).toHaveLength(2);
    expect(DEMO_USERS.every((user) => user.role === "Super Admin" && user.passwordHash?.length === 64)).toBe(true);
    expect(DEMO_USERS.map((user) => user.email)).toEqual(["andre.alvesman@gmail.com", "comercial@metodosarke.com.br"]);
  });

  it("rejects a wrong password without exposing a user", async () => {
    expect(await getDemoUser("andre.alvesman@gmail.com", "senha-incorreta")).toBeUndefined();
  });

  it("provides one named login for each requested module", async () => {
    expect(DEMO_MODULE_USERS).toHaveLength(6);
    expect(hasModuleDemoAccounts()).toBe(true);
    expect((await getModuleDemoUser("academia", "academia", DEMO_PASSWORD))?.role).toBe("Gestor de Academia");
    expect((await getModuleDemoUser("studio", "studio", DEMO_PASSWORD))?.role).toBe("Gestor de Studio");
    expect((await getModuleDemoUser("profissional", "personal", DEMO_PASSWORD))?.name).toBe("Camila Rocha");
    expect((await getModuleDemoUser("profissional", "nutricionista", DEMO_PASSWORD))?.role).toBe("Nutricionista");
    expect((await getModuleDemoUser("aluno", "aluno", DEMO_PASSWORD))?.name).toBe("Marina Costa");
    expect((await getModuleDemoUser("administrador", "administrador", DEMO_PASSWORD))?.role).toBe("Administrador");
  });

  it("defines least-privilege permissions for each module", async () => {
    expect(MODULE_PERMISSIONS.aluno).toEqual(["overview", "alunos", "agenda"]);
    expect(MODULE_PERMISSIONS.profissional).not.toContain("saas");
    expect(MODULE_PERMISSIONS.administrador).toContain("saas");
    expect(await getModuleDemoUser("aluno", "aluno", "senha-incorreta")).toBeUndefined();
  });

  it("isolates the Academy subsystem from SaaS administration", () => {
    expect(MODULE_PERMISSIONS.academia).toEqual(["overview", "academias", "alunos", "agenda", "financeiro", "integracoes"]);
    expect(MODULE_PERMISSIONS.studio).not.toContain("admin");
    expect(MODULE_PERMISSIONS.administrador).toContain("admin");
  });

  it("provides branded clients for the main commercial modules", () => {
    expect(DEMO_CLIENTS).toHaveLength(3);
    expect(DEMO_CLIENTS.every((client) => client.logoUrl.length > 0)).toBe(true);
  });

  it("seeds exactly two presentation clients for every module", () => {
    expect(hasTwoDemoClientsPerModule()).toBe(true);
    expect(DEMO_MODULE_CLIENTS.academias).toEqual(["Vértice Studio", "Box Norte 360"]);
    expect(DEMO_MODULE_CLIENTS.profissionais).toEqual(["Camila Rocha", "Rafael Mendes"]);
    expect(DEMO_MODULE_CLIENTS.alunos).toEqual(["Marina Costa", "Lucas Ferreira"]);
  });

  it("provides a valid multi-tenant SaaS catalog", () => {
    expect(hasValidSaaSDemoCatalog()).toBe(true);
    expect(DEMO_TENANTS.map((tenant) => tenant.name)).toEqual(["Rede Arke Demo", "Vértice Studio", "Box Norte 360"]);
    expect(SAAS_PLANS).toEqual(["Starter", "Growth", "Scale"]);
  });
});

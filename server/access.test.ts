import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAccessRoutes } from "./access";
import * as supabaseAdmin from "./supabaseAdmin";
import * as integrations from "./integrations";

type Handler = (req: any, res: any) => unknown;

function makeRoutes() {
  const routes: Record<string, Handler> = {};
  registerAccessRoutes({ post: (path: string, next: Handler) => { routes[path] = next; } } as any);
  return routes;
}

function makeRoute() {
  return makeRoutes()["/api/v1/access/check-in"];
}

function response() {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  return { state, res: { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } };
}

describe("access.check-in (demo — sem CATRACA_API_KEY configurada)", () => {
  it("allows a valid demo check-in", () => {
    const handler = makeRoute();
    const { state, res } = response();
    handler({ body: { academyId: "vertice", studentId: "student-123", provider: "topdata" }, header: () => undefined }, res);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true, decision: "allowed", mode: "demo", provider: "topdata" });
  });

  it("rejects an incomplete payload", () => {
    const handler = makeRoute();
    const { state, res } = response();
    handler({ body: { academyId: "vertice" }, header: () => undefined }, res);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ ok: false, code: "INVALID_PAYLOAD" });
  });

  it("returns a deterministic denied decision for blocked demo identifiers", () => {
    const handler = makeRoute();
    const { state, res } = response();
    handler({ body: { academyId: "vertice", studentId: "blocked-student" }, header: () => undefined }, res);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true, decision: "denied" });
  });
});

// Camada genérica de catraca — modo "configured" (CATRACA_API_KEY definida):
// aqui a decisão passa a ser real (matrícula ativa na organização), não
// mais o stub por palavra-chave do modo demo. Qualquer agente local de
// qualquer marca (Control iD, Topdata, Henry, Dimep) que fale este
// contrato HTTP genérico cai neste caminho.
describe("access.check-in (configured — dispositivo autenticado)", () => {
  const originalEnv = process.env.CATRACA_API_KEY;

  beforeEach(() => {
    process.env.CATRACA_API_KEY = "device-secret";
  });

  afterEach(() => {
    process.env.CATRACA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects a request with a missing or wrong device key", () => {
    const handler = makeRoute();
    const { state, res } = response();
    handler({ body: { academyId: "vertice", studentId: "aluno-1" }, header: () => "wrong-key" }, res);
    expect(state.status).toBe(401);
    expect(state.body).toMatchObject({ ok: false, code: "INVALID_DEVICE_KEY" });
  });

  it("allows and registers frequência when the member is active in that organization", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno Teste", organization_id: "org-1", status: "active", unit_id: null, matricula_em: null });
    const registrarFrequenciaSpy = vi.spyOn(supabaseAdmin, "registrarFrequencia").mockResolvedValue({} as any);

    const handler = makeRoute();
    const { state, res } = response();
    await handler({ body: { academyId: "vertice", organizationId: "org-1", studentId: "aluno-1", provider: "control_id" }, header: () => "device-secret" }, res);

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true, decision: "allowed", mode: "configured" });
    expect(registrarFrequenciaSpy).toHaveBeenCalledWith(expect.objectContaining({ alunoId: "aluno-1", organizationId: "org-1", origem: "catraca" }));
  });

  it("denies when the member belongs to a different organization", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno Teste", organization_id: "org-2", status: "active", unit_id: null, matricula_em: null });

    const handler = makeRoute();
    const { state, res } = response();
    await handler({ body: { academyId: "vertice", organizationId: "org-1", studentId: "aluno-1" }, header: () => "device-secret" }, res);

    expect(state.body).toMatchObject({ ok: true, decision: "denied" });
  });

  it("denies when the membership is not active", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockResolvedValue({ user_id: "aluno-1", full_name: "Aluno Teste", organization_id: "org-1", status: "suspended", unit_id: null, matricula_em: null });

    const handler = makeRoute();
    const { state, res } = response();
    await handler({ body: { academyId: "vertice", organizationId: "org-1", studentId: "aluno-1" }, header: () => "device-secret" }, res);

    expect(state.body).toMatchObject({ ok: true, decision: "denied" });
  });

  it("fails closed (denies) when the membership check errors out", async () => {
    vi.spyOn(supabaseAdmin, "getProfileByUserId").mockRejectedValue(new Error("Supabase indisponível"));

    const handler = makeRoute();
    const { state, res } = response();
    await handler({ body: { academyId: "vertice", organizationId: "org-1", studentId: "aluno-1" }, header: () => "device-secret" }, res);

    expect(state.body).toMatchObject({ ok: true, decision: "denied" });
  });
});

// B2 (D-B1): o agente local reporta de volta por HTTP autenticado — mesmo
// contrato de device key do check-in — já que a nuvem nunca fica esperando
// uma conexão WebSocket aberta dentro da função serverless.
describe("access.heartbeat / access.test-result", () => {
  const originalEnv = process.env.CATRACA_API_KEY;

  beforeEach(() => {
    process.env.CATRACA_API_KEY = "device-secret";
  });

  afterEach(() => {
    process.env.CATRACA_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects heartbeat with a missing or wrong device key", async () => {
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/heartbeat"]({ body: { deviceId: "device-1" }, header: () => "wrong-key" }, res);
    expect(state.status).toBe(401);
  });

  it("records a heartbeat for a known device", async () => {
    const heartbeatSpy = vi.spyOn(integrations, "recordTurnstileHeartbeat").mockResolvedValue({ success: true });
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/heartbeat"]({ body: { deviceId: "device-1" }, header: () => "device-secret" }, res);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ ok: true });
    expect(heartbeatSpy).toHaveBeenCalledWith("device-1");
  });

  it("returns 404 for a heartbeat from an unknown device", async () => {
    vi.spyOn(integrations, "recordTurnstileHeartbeat").mockResolvedValue({ success: false });
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/heartbeat"]({ body: { deviceId: "device-x" }, header: () => "device-secret" }, res);
    expect(state.status).toBe(404);
  });

  it("rejects test-result with an invalid result value", async () => {
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/test-result"]({ body: { deviceId: "device-1", result: "maybe" }, header: () => "device-secret" }, res);
    expect(state.status).toBe(400);
  });

  it("records a successful test-result", async () => {
    const resultSpy = vi.spyOn(integrations, "reportTurnstileTestResult").mockResolvedValue({ success: true });
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/test-result"]({ body: { deviceId: "device-1", result: "success" }, header: () => "device-secret" }, res);
    expect(state.status).toBe(200);
    expect(resultSpy).toHaveBeenCalledWith("device-1", "success", undefined);
  });

  it("fails with 502 when reporting the test-result errors out", async () => {
    vi.spyOn(integrations, "reportTurnstileTestResult").mockRejectedValue(new Error("Supabase indisponível"));
    const routes = makeRoutes();
    const { state, res } = response();
    await routes["/api/v1/access/test-result"]({ body: { deviceId: "device-1", result: "failed", message: "timeout" }, header: () => "device-secret" }, res);
    expect(state.status).toBe(502);
  });
});

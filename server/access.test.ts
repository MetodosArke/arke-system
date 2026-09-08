import { describe, expect, it } from "vitest";
import { registerAccessRoutes } from "./access";

type Handler = (req: any, res: any) => unknown;

function makeRoute() {
  let handler: Handler | undefined;
  registerAccessRoutes({ post: (_path: string, next: Handler) => { handler = next; } } as any);
  if (!handler) throw new Error("route not registered");
  return handler;
}

function response() {
  const state: { status: number; body: unknown } = { status: 200, body: undefined };
  return { state, res: { status(code: number) { state.status = code; return this; }, json(body: unknown) { state.body = body; return this; } } };
}

describe("access.check-in", () => {
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

import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";

type AccessRequest = {
  academyId?: string;
  unitId?: string;
  studentId?: string;
  document?: string;
  deviceId?: string;
  provider?: "topdata" | "madis" | "henry" | "control_id" | "arke_demo";
};

const normalize = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function registerAccessRoutes(app: Express) {
  app.post("/api/v1/access/check-in", (req: Request, res: Response) => {
    const expectedKey = process.env.CATRACA_API_KEY;
    const providedKey = normalize(req.header("x-arke-device-key"));
    if (expectedKey && providedKey !== expectedKey) {
      return res.status(401).json({ ok: false, code: "INVALID_DEVICE_KEY", message: "Dispositivo não autorizado." });
    }

    const body = (req.body ?? {}) as AccessRequest;
    const academyId = normalize(body.academyId);
    const unitId = normalize(body.unitId);
    const studentId = normalize(body.studentId);
    const document = normalize(body.document);
    const deviceId = normalize(body.deviceId) || "demo-gate-01";
    const provider = body.provider ?? "arke_demo";

    if (!academyId || (!studentId && !document)) {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "academyId e studentId ou document são obrigatórios." });
    }

    // Sandbox behavior: this is deliberately deterministic and does not unlock physical hardware.
    // Production adapters can map the same contract to Topdata, Madis, Henry or Control iD.
    const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
    const eventId = `access_${randomUUID()}`;
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
      checkedAt: new Date().toISOString(),
      message: denied ? "Acesso bloqueado para demonstração." : "Acesso liberado em modo demonstração."
    });
  });
}

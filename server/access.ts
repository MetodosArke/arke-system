import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { registrarFrequencia } from "./supabaseAdmin";

type AccessRequest = {
  academyId?: string;
  // organizationId é o id real da organização (saas_organizations) — o
  // adaptador de catraca por marca ainda não existe (CLAUDE.md §8.4),
  // então isto só é usado para registrar frequência quando o payload
  // já vem de um vínculo real; sem ele, o contrato de sandbox continua
  // igual (academyId sozinho, sem persistir nada).
  organizationId?: string;
  unitId?: string;
  studentId?: string;
  document?: string;
  deviceId?: string;
  provider?: "topdata" | "madis" | "henry" | "control_id";
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
    const organizationId = normalize(body.organizationId);
    const unitId = normalize(body.unitId);
    const studentId = normalize(body.studentId);
    const document = normalize(body.document);
    const deviceId = normalize(body.deviceId);
    const provider = body.provider;

    if (!academyId || (!studentId && !document)) {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "academyId e studentId ou document são obrigatórios." });
    }

    // Sandbox behavior: this is deliberately deterministic and does not unlock physical hardware.
    // Production adapters can map the same contract to Topdata, Madis, Henry or Control iD.
    const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
    const eventId = `access_${randomUUID()}`;

    // Registro de frequência é best-effort e nunca atrasa a resposta:
    // a catraca física não pode esperar uma volta ao banco para abrir.
    if (!denied && organizationId && studentId) {
      registrarFrequencia({ alunoId: studentId, organizationId, unitId: unitId || undefined, origem: "catraca" }).catch(() => {});
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
      checkedAt: new Date().toISOString(),
      message: denied ? "Acesso bloqueado para esta credencial." : "Acesso liberado."
    });
  });
}

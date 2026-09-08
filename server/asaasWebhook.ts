import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { persistAsaasEvent, upsertAsaasPayment } from "./asaasPersistence";

type AsaasEvent = { id?: string; event?: string; dateCreated?: string; payment?: Record<string, unknown> };

function tokenMatches(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function registerAsaasWebhook(app: Express) {
  app.post("/api/webhooks/asaas", async (req: Request, res: Response) => {
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN ?? "";
    const receivedToken = String(req.header("asaas-access-token") ?? "");
    if (!expectedToken || !tokenMatches(receivedToken, expectedToken)) return res.status(401).json({ received: false, error: "invalid webhook token" });
    const body = req.body as AsaasEvent;
    if (!body?.id || !body.event) return res.status(400).json({ received: false, error: "invalid event" });
    try {
      const result = await persistAsaasEvent({ eventId: body.id, event: body.event, occurredAt: body.dateCreated, payload: body as Record<string, unknown> });
      if (!result.duplicate && body.payment) await upsertAsaasPayment(body.payment, body.event);
      return res.status(200).json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      console.error("[Asaas webhook] failed", error);
      return res.status(500).json({ received: false });
    }
  });
}

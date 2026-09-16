import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { runAutomacaoDiaria } from "./supabaseAdmin";
import { runArkeRepasseMensal } from "./arkeBilling";
import { runArkeLembretesDiarios } from "./arkeLembretes";
import { runArkeDesafiosAutomaticos } from "./arkeDesafiosAutomaticos";
import { runArkeCompeticoesAutomaticas } from "./arkeCompeticoesAutomaticas";
import { captureException } from "./_core/errorMonitoring";

function tokenMatches(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function registerAutomacaoCron(app: Express) {
  app.get("/api/cron/automacao", async (req: Request, res: Response) => {
    const expectedToken = process.env.CRON_SECRET ?? "";
    const receivedToken = String(req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expectedToken || !tokenMatches(receivedToken, expectedToken)) return res.status(401).json({ ok: false, error: "unauthorized" });
    try {
      const [resultado, arkeRepasse, arkeLembretes, arkeDesafios, arkeCompeticoes] = await Promise.all([runAutomacaoDiaria(), runArkeRepasseMensal(), runArkeLembretesDiarios(), runArkeDesafiosAutomaticos(), runArkeCompeticoesAutomaticas()]);
      return res.status(200).json({ ok: true, ...resultado, arkeRepasse, arkeLembretes, arkeDesafios, arkeCompeticoes });
    } catch (error) {
      captureException(error, { job: "automacao_diaria" });
      return res.status(500).json({ ok: false });
    }
  });
}

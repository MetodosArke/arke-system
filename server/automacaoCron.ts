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

// Promise.all fazia a falha de UM job (mesmo uma chamada isolada, tipo
// listArkeModulesEnabled() sem try/catch próprio) rejeitar o request
// inteiro — os outros 4 jobs podiam já ter terminado com sucesso e
// gravado no banco, mas a resposta reportava um 500 genérico sem dizer
// qual falhou, escondendo inclusive sucessos reais (ex. escalonamento de
// atendimento vencido, CLAUDE.md §10). Promise.allSettled isola cada job.
const JOBS = [
  { key: "resultado", name: "automacao_diaria", run: runAutomacaoDiaria },
  { key: "arkeRepasse", name: "arke_repasse_mensal", run: runArkeRepasseMensal },
  { key: "arkeLembretes", name: "arke_lembretes_diarios", run: runArkeLembretesDiarios },
  { key: "arkeDesafios", name: "arke_desafios_automaticos", run: runArkeDesafiosAutomaticos },
  { key: "arkeCompeticoes", name: "arke_competicoes_automaticas", run: runArkeCompeticoesAutomaticas },
] as const;

export function registerAutomacaoCron(app: Express) {
  app.get("/api/cron/automacao", async (req: Request, res: Response) => {
    const expectedToken = process.env.CRON_SECRET ?? "";
    const receivedToken = String(req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expectedToken || !tokenMatches(receivedToken, expectedToken)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const settled = await Promise.allSettled(JOBS.map((job) => job.run()));
    const body: Record<string, unknown> = {};
    let anyFailed = false;
    settled.forEach((outcome, index) => {
      const job = JOBS[index];
      if (outcome.status === "fulfilled") {
        body[job.key] = outcome.value;
      } else {
        anyFailed = true;
        captureException(outcome.reason, { job: job.name });
        body[job.key] = { ok: false, error: outcome.reason instanceof Error ? outcome.reason.message : "Falha desconhecida." };
      }
    });
    // Sempre 200: o cron da Vercel só usa o status HTTP pra saber se disparou,
    // e cada job já reporta o próprio sucesso/erro dentro do corpo.
    return res.status(200).json({ ok: !anyFailed, ...body });
  });
}

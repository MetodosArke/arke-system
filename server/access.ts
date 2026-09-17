import type { Express, Request, Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { getProfileByUserId, registrarFrequencia } from "./supabaseAdmin";
import { recordTurnstileHeartbeat, reportTurnstileTestResult } from "./integrations";
import { captureException } from "./_core/errorMonitoring";
import type { TurnstileBrand } from "@shared/turnstile";

// Camada genérica de catraca (CLAUDE.md §8.4/§4): nenhuma das marcas
// mapeadas em @shared/turnstile tem API de nuvem pública documentada o
// suficiente para implementar o protocolo com segurança hoje — as
// primeiras quatro pesquisadas (Control iD, Topdata, Henry, Dimep) são
// hardware de rede local (LAN), sem webhook de nuvem oficial. Controle iD
// é a mais próxima disso (notifica um endpoint HTTP local configurado no
// próprio equipamento, ex. .../api/notifications/catra_event, com eventos
// como EVENT_TURN_LEFT/EVENT_TURN_RIGHT), mas ainda assim só na rede
// local do equipamento — nunca alcança a Vercel diretamente.
//
// Por isso o desenho aqui é: cada academia roda um agente/middleware local
// (fora deste repositório, específico da marca dela) que fala o protocolo
// nativo do fabricante e traduz o evento para ESTE contrato HTTP genérico,
// autenticado por `CATRACA_API_KEY`. Trocar de marca não deveria exigir
// tocar em nenhuma linha deste arquivo — só o agente local muda. `brand`
// aqui é só o identificador que a organização já escolheu ao configurar a
// unidade (ver @shared/turnstile para a lista completa mapeada).
type CatracaProvider = TurnstileBrand;

type AccessRequest = {
  academyId?: string;
  organizationId?: string;
  unitId?: string;
  studentId?: string;
  document?: string;
  deviceId?: string;
  provider?: CatracaProvider;
};

const normalize = (value: unknown) => typeof value === "string" ? value.trim() : "";

// Comparação em tempo constante — a chave autentica um dispositivo físico
// pela rede; comparar com !== normal vaza quantos caracteres iniciais
// batem via timing, permitindo recuperar a chave aos poucos (CWE-208).
function deviceKeyMatches(providedKey: string, expectedKey: string): boolean {
  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireDeviceKey(req: Request, res: Response): boolean {
  const expectedKey = process.env.CATRACA_API_KEY;
  const providedKey = normalize(req.header("x-arke-device-key"));
  if (expectedKey && !deviceKeyMatches(providedKey, expectedKey)) {
    res.status(401).json({ ok: false, code: "INVALID_DEVICE_KEY", message: "Dispositivo não autorizado." });
    return false;
  }
  return true;
}

export function registerAccessRoutes(app: Express) {
  app.post("/api/v1/access/check-in", async (req: Request, res: Response) => {
    if (!requireDeviceKey(req, res)) return;
    const expectedKey = process.env.CATRACA_API_KEY;

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

    const configured = Boolean(expectedKey);
    const eventId = `access_${randomUUID()}`;
    let decision: "allowed" | "denied";
    let message: string;

    if (!configured) {
      // Sandbox: sem CATRACA_API_KEY configurada, ninguém autenticou um
      // dispositivo de verdade — mantém o comportamento determinístico de
      // demonstração (não decide nada real, não abre catraca física).
      const denied = studentId.toLowerCase().includes("blocked") || document.endsWith("0000");
      decision = denied ? "denied" : "allowed";
      message = denied ? "Acesso bloqueado para esta credencial." : "Acesso liberado.";
    } else {
      // Dispositivo/agente autenticado de verdade: decisão real, baseada em
      // matrícula ativa — não em documento (CPF), porque `profiles` ainda
      // não tem esse campo indexado; o agente local precisa mandar o
      // studentId (uuid do Arke) hoje. Falha de verificação nega por
      // padrão (fail closed) — nunca libera catraca física por incerteza.
      try {
        const profile = studentId ? await getProfileByUserId(studentId) : null;
        if (!profile || profile.organization_id !== organizationId) {
          decision = "denied";
          message = "Aluno não encontrado nesta organização.";
        } else if (profile.status !== "active") {
          decision = "denied";
          message = "Matrícula não está ativa.";
        } else {
          decision = "allowed";
          message = "Acesso liberado.";
        }
      } catch (error) {
        captureException(error, { route: "access.check-in", organizationId, studentId });
        decision = "denied";
        message = "Não foi possível verificar a matrícula no momento.";
      }
    }

    // Registro de frequência é best-effort e nunca atrasa a resposta:
    // a catraca física não pode esperar uma volta ao banco para abrir.
    // Só grava em modo configurado — sem CATRACA_API_KEY não há
    // dispositivo autenticado nem matrícula verificada, então este bloco
    // não pode gravar frequência real de aluno/organização nenhum
    // (ver comentário do modo "demo" acima).
    if (configured && decision === "allowed" && organizationId && studentId) {
      registrarFrequencia({ alunoId: studentId, organizationId, unitId: unitId || undefined, origem: "catraca" }).catch((error) => {
        captureException(error, { route: "access.check-in.registrarFrequencia", organizationId, studentId });
      });
    }

    return res.status(200).json({
      ok: true,
      mode: configured ? "configured" : "demo",
      eventId,
      decision,
      academyId,
      unitId: unitId || null,
      studentId: studentId || null,
      document: document || null,
      deviceId,
      provider,
      checkedAt: new Date().toISOString(),
      message,
    });
  });

  // Heartbeat (B2, D-B1): o agente local chama periodicamente para provar
  // que ainda está de pé — sem isso o status exibido cai para "offline"
  // depois de alguns minutos sem sinal (ver computeStatus em integrations.ts).
  app.post("/api/v1/access/heartbeat", async (req: Request, res: Response) => {
    if (!requireDeviceKey(req, res)) return;
    const deviceId = normalize((req.body ?? {}).deviceId);
    const organizationId = normalize((req.body ?? {}).organizationId);
    if (!deviceId || !organizationId) return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "deviceId e organizationId são obrigatórios." });
    try {
      const result = await recordTurnstileHeartbeat(deviceId, organizationId);
      if (!result.success) return res.status(404).json({ ok: false, code: "DEVICE_NOT_FOUND", message: "Catraca não encontrada." });
      return res.status(200).json({ ok: true });
    } catch (error) {
      captureException(error, { route: "access.heartbeat", deviceId, organizationId });
      return res.status(502).json({ ok: false, code: "HEARTBEAT_FAILED", message: "Não foi possível registrar o heartbeat." });
    }
  });

  // Resultado do "testar conexão" (B2): a nuvem só publica o sinal via
  // Supabase Realtime (server/turnstileRealtime.ts) — quem testa de
  // verdade a rede local e reporta o resultado é o agente, aqui.
  app.post("/api/v1/access/test-result", async (req: Request, res: Response) => {
    if (!requireDeviceKey(req, res)) return;
    const body = (req.body ?? {}) as { deviceId?: string; organizationId?: string; result?: string; message?: string; requestedAt?: string };
    const deviceId = normalize(body.deviceId);
    const organizationId = normalize(body.organizationId);
    const result = body.result;
    if (!deviceId || !organizationId || (result !== "success" && result !== "failed")) {
      return res.status(400).json({ ok: false, code: "INVALID_PAYLOAD", message: "deviceId, organizationId e result ('success'|'failed') são obrigatórios." });
    }
    try {
      const outcome = await reportTurnstileTestResult(deviceId, organizationId, result, normalize(body.message) || undefined, normalize(body.requestedAt) || undefined);
      if (!outcome.success) return res.status(404).json({ ok: false, code: "DEVICE_NOT_FOUND", message: "Catraca não encontrada." });
      return res.status(200).json({ ok: true, stale: outcome.stale ?? false });
    } catch (error) {
      captureException(error, { route: "access.test-result", deviceId, organizationId });
      return res.status(502).json({ ok: false, code: "TEST_RESULT_FAILED", message: "Não foi possível registrar o resultado do teste." });
    }
  });
}

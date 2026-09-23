import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import { giroDoEvento } from "../src/receptores/controlid";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { ConfirmacaoGiro, GatewayConfig } from "../src/types";

/**
 * Confirmação de giro pelo Monitor da Control iD (catra_event).
 *
 * "Liberado" não é "entrou": a pessoa pode ser liberada e desistir na frente
 * da borboleta. Desde que a catraca passou a gerar presença, e presença
 * alimenta constância, inércia e avanço de fase, a desistência não pode
 * contar. Estes testes simulam o equipamento com o payload documentado:
 * https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 */

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 3000,
  modelo_catraca: "controlid",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "catra_event",
  timeout_giro_ms: 30_000,
};

function ambiente(confirmacaoGiro: ConfirmacaoGiro = "catra_event", timeoutGiroMs = 30_000) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-giro-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("controlid"), cloud, alunosCache, logsQueue);
  const { app } = criarServidorReceptor(gateway, { host: "127.0.0.1", porta: 0, confirmacaoGiro, timeoutGiroMs });
  return { dataDir, alunosCache, logsQueue, cloud, gateway, app };
}

type Amb = ReturnType<typeof ambiente>;

/** Identificação, como o equipamento manda: urlencoded, com device_id e uuid. */
const identificar = (amb: Amb, campos: Record<string, string>) =>
  amb.app.inject({
    method: "POST",
    url: "/new_user_identified.fcgi",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ device_id: "935107", event: "7", portal_id: "1", ...campos }).toString(),
  });

/** Aviso do Monitor, como o equipamento manda: JSON. */
const catraEvent = (amb: Amb, nome: string, uuid: string, deviceId = 935107) =>
  amb.app.inject({
    method: "POST",
    url: "/api/notifications/catra_event",
    headers: { "content-type": "application/json" },
    payload: { event: { type: 7, name: nome, time: 1484126902, uuid }, device_id: deviceId, time: 1484126902 },
  });

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("giroDoEvento — nomes do Monitor", () => {
  it("reconhece os três desfechos, com e sem o prefixo EVENT_", () => {
    expect(giroDoEvento("TURN LEFT")).toBe("confirmado");
    expect(giroDoEvento("EVENT_TURN_RIGHT")).toBe("confirmado");
    expect(giroDoEvento("GIVE UP")).toBe("desistencia");
    expect(giroDoEvento("EVENT_GIVE_UP")).toBe("desistencia");
  });
  it("não inventa desfecho para evento desconhecido", () => {
    expect(giroDoEvento("DOOR OPEN")).toBeNull();
    expect(giroDoEvento(undefined)).toBeNull();
  });
});

describe("Confirmação de giro — online", () => {
  let amb: Amb;
  beforeEach(() => {
    amb = ambiente();
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  });
  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("pede à nuvem para o registro nascer esperando o giro", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    expect(amb.cloud.opcoesRecebidas[0]).toEqual({ aguardarGiro: true });
  });

  it("giro confirmado fecha o registro como confirmado", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "TURN LEFT", "a1");
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "confirmado" }]);
  });

  it("desistência fecha como desistência — e não vira presença", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "GIVE UP", "a1");
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "desistencia" }]);
  });

  it("o mesmo aviso repetido não fecha duas vezes", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "TURN LEFT", "a1");
    await catraEvent(amb, "TURN LEFT", "a1");
    expect(amb.cloud.girosConfirmados).toHaveLength(1);
  });

  it("uuid diferente, mas um só acesso esperando naquele equipamento: é ele", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "TURN RIGHT", "outro-uuid");
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "confirmado" }]);
  });

  it("com dois esperando e uuid desconhecido, não adivinha", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Bia", log_id: "log-2" };
    await identificar(amb, { user_id: "13", uuid: "a2" });
    await catraEvent(amb, "TURN LEFT", "outro-uuid");
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("giro de outro equipamento não fecha o acesso desta catraca", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "TURN LEFT", "a1", 999);
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("acesso negado não fica esperando giro", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Matrícula pausada." };
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "TURN LEFT", "a1");
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("evento desconhecido e outros avisos do Monitor recebem 200, sem efeito", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    expect((await catraEvent(amb, "DOOR OPEN", "a1")).statusCode).toBe(200);
    const dao = await amb.app.inject({ method: "POST", url: "/api/notifications/dao", payload: {} });
    expect(dao.statusCode).toBe(200);
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("nuvem fora no aviso de giro não derruba a resposta ao equipamento", async () => {
    amb.cloud.erroConfirmarGiro = new Error("rede");
    await identificar(amb, { user_id: "12", uuid: "a1" });
    expect((await catraEvent(amb, "TURN LEFT", "a1")).statusCode).toBe(200);
  });
});

describe("Confirmação de giro — prazo", () => {
  it("sem catra_event no prazo, fecha como sem confirmação (conta presença)", async () => {
    const amb = ambiente("catra_event", 40);
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await espera(120);
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "sem_confirmacao" }]);
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });
});

describe("Confirmação de giro — contingência offline", () => {
  let amb: Amb;
  beforeEach(async () => {
    amb = ambiente();
    amb.cloud.erroValidarAcesso = new Error("sem internet");
    await amb.alunosCache.substituirTodos([
      { aluno_id: "aluno-12", cpf: "", nome: "Ana", inadimplente: false, identificador_catraca: "12" },
      { aluno_id: "aluno-13", cpf: "", nome: "Bia", inadimplente: true, identificador_catraca: "13" },
    ]);
  });
  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("o acesso decidido pelo cache é registrado — antes se perdia", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    const fila = await amb.logsQueue.listarPendentes();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ aluno_id: "aluno-12", cpf_consultado: "id:12", resultado: "liberado", giro: "pendente" });
  });

  it("a negação pelo cache também é registrada", async () => {
    await identificar(amb, { user_id: "13", uuid: "a1" });
    const fila = await amb.logsQueue.listarPendentes();
    expect(fila).toHaveLength(1);
    expect(fila[0].resultado).toBe("negado_inadimplente");
    expect(fila[0].giro).toBeUndefined();
  });

  it("o giro fecha o registro local, e ele sobe para a nuvem já com o desfecho", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "GIVE UP", "a1");
    amb.cloud.erroValidarAcesso = null;
    await amb.gateway.flushLogsPendentes();
    expect(amb.cloud.logsRecebidos).toHaveLength(1);
    expect(amb.cloud.logsRecebidos[0]).toMatchObject({ resultado: "liberado", giro: "desistencia" });
  });
});

describe("Sem Monitor (modo decisao, o padrão)", () => {
  let amb: Amb;
  beforeEach(() => {
    amb = ambiente("decisao");
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  });
  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("não pede para aguardar giro: a liberação já é a presença", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    expect(amb.cloud.opcoesRecebidas[0]).toEqual({ aguardarGiro: false });
  });

  it("um catra_event perdido não fecha nada", async () => {
    await identificar(amb, { user_id: "12", uuid: "a1" });
    await catraEvent(amb, "GIVE UP", "a1");
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("na contingência, o acesso entra na fila sem giro pendente", async () => {
    amb.cloud.erroValidarAcesso = new Error("sem internet");
    await amb.alunosCache.substituirTodos([
      { aluno_id: "aluno-12", cpf: "", nome: "Ana", inadimplente: false, identificador_catraca: "12" },
    ]);
    await identificar(amb, { user_id: "12", uuid: "a1" });
    const fila = await amb.logsQueue.listarPendentes();
    expect(fila[0].resultado).toBe("liberado");
    expect(fila[0].giro).toBeUndefined();
  });
});

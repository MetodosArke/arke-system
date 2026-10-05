import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import { ipsPermitidos, origemPermitida } from "../src/server/origemEquipamento";
import { carregarConfig } from "../src/config";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { GatewayConfig } from "../src/types";

/**
 * O receptor escuta na rede da academia, que não é de confiança. Com os
 * equipamentos listados no config, só eles (e a própria máquina) falam com
 * ele: um aparelho qualquer da rede não pede decisão, não fecha giro e não
 * manda acesso histórico.
 */

const BASE: GatewayConfig = {
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
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

const abertos: { app: { close: () => Promise<unknown> }; dir: string }[] = [];
afterEach(async () => {
  for (const a of abertos.splice(0)) {
    await a.app.close();
    fs.rmSync(a.dir, { recursive: true, force: true });
  }
});

function ambiente(permitidos?: Set<string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-origem-test-"));
  const cloud = new FakeCloudClient();
  cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  const gateway = new GatewayService(BASE, new ReceptorDriver("controlid"), cloud, new AlunosCache(dir), new LogsQueue(dir));
  const { app } = criarServidorReceptor(gateway, {
    host: "127.0.0.1",
    porta: 0,
    intelbras: { nomePorIp: () => "Terminal" },
    ...(permitidos ? { ipsPermitidos: permitidos } : {}),
  });
  abertos.push({ app, dir });
  return { app, cloud };
}

type Amb = ReturnType<typeof ambiente>;
const identificar = (amb: Amb, ip: string) =>
  amb.app.inject({
    method: "POST",
    url: "/new_user_identified.fcgi",
    remoteAddress: ip,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ device_id: "935107", user_id: "42", uuid: "u-1" }).toString(),
  });

describe("lista de quem fala com o receptor", () => {
  it("junta os IPs das três listas do config, sem o prefixo de IPv6", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-origem-config-"));
    const arquivo = path.join(dir, "config.json");
    fs.writeFileSync(
      arquivo,
      JSON.stringify({
        ...BASE,
        controlid_equipamentos: [{ nome: "iDBlock", ip: "10.0.0.5", senha: "x" }],
        intelbras_equipamentos: [{ nome: "SS 3530", ip: "::ffff:10.0.0.9", senha: "x" }],
        equipamentos_permitidos: ["10.0.0.20"],
      })
    );
    const cfg = carregarConfig(arquivo);
    fs.rmSync(dir, { recursive: true, force: true });
    expect([...ipsPermitidos(cfg)].sort()).toEqual(["10.0.0.20", "10.0.0.5", "10.0.0.9"]);
  });

  it("a própria máquina sempre passa; sem lista, todos passam", () => {
    const lista = new Set(["10.0.0.5"]);
    expect(origemPermitida(lista, "127.0.0.1")).toBe(true);
    expect(origemPermitida(lista, "::ffff:127.0.0.1")).toBe(true);
    expect(origemPermitida(lista, "::ffff:10.0.0.5")).toBe(true);
    expect(origemPermitida(lista, "10.0.0.66")).toBe(false);
    expect(origemPermitida(new Set(), "10.0.0.66")).toBe(true);
  });
});

describe("receptor com a lista de equipamentos", () => {
  it("o equipamento listado é atendido", async () => {
    const amb = ambiente(new Set(["10.0.0.5"]));
    const r = await identificar(amb, "10.0.0.5");
    expect(r.statusCode).toBe(200);
    expect(r.json().result.event).toBe(7);
  });

  it("aparelho fora da lista leva 403 e não chega à nuvem", async () => {
    const amb = ambiente(new Set(["10.0.0.5"]));
    const r = await identificar(amb, "10.0.0.66");
    expect(r.statusCode).toBe(403);
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("fora da lista também não fecha giro, não tira a catraca da contingência nem fala como Intelbras", async () => {
    const amb = ambiente(new Set(["10.0.0.5"]));
    const rotas: { method: "POST" | "GET"; url: string }[] = [
      { method: "POST", url: "/api/notifications/catra_event" },
      { method: "POST", url: "/device_is_alive.fcgi" },
      { method: "POST", url: "/new_card.fcgi" },
      { method: "GET", url: "/keepalive" },
      { method: "POST", url: "/notification" },
    ];
    for (const rota of rotas) {
      const r = await amb.app.inject({ ...rota, remoteAddress: "10.0.0.66" });
      expect(r.statusCode, rota.url).toBe(403);
    }
  });

  it("a sonda de vida da porta segue aberta para o técnico", async () => {
    const amb = ambiente(new Set(["10.0.0.5"]));
    const r = await amb.app.inject({ method: "GET", url: "/health", remoteAddress: "10.0.0.66" });
    expect(r.statusCode).toBe(200);
  });

  it("a ponte Topdata segue com a regra dela: só a própria máquina", async () => {
    const amb = ambiente(new Set(["10.0.0.5"]));
    const de = (ip: string) =>
      amb.app.inject({ method: "POST", url: "/topdata/bilhetes", remoteAddress: ip, payload: { bilhetes: [] } });
    expect((await de("10.0.0.5")).statusCode).toBe(403);
    expect((await de("127.0.0.1")).statusCode).not.toBe(403);
  });

  it("sem lista, atende qualquer aparelho, como até a 1.6", async () => {
    const amb = ambiente();
    const r = await identificar(amb, "10.0.0.66");
    expect(r.statusCode).toBe(200);
  });
});

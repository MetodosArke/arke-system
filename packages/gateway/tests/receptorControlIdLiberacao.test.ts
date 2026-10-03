import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import { acoesDeLiberacao, ipDoEquipamento, resolverComoLiberar } from "../src/receptores/controlid";
import { GestaoControlId } from "../src/equipamentos/controlidGestao";
import { carregarConfig } from "../src/config";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { EquipamentoControlIdFalso } from "./helpers/equipamentoControlIdFalso";
import type { EquipamentoControlId, GatewayConfig } from "../src/types";

/**
 * Cada modelo da Control iD libera de um jeito (documentação "Abertura
 * remota de porta e catraca" e "Eventos de identificação online"): a
 * iDBlock gira a borboleta (`catra`), o leitor numa catraca de outra marca
 * fecha o relé (`door`) e o iDFlex e o iDAccess Pro e Nano acionam o SecBox
 * (`sec_box`). O Gateway reconhece o equipamento pelo IP de quem chama.
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
  confirmacao_giro: "catra_event",
  timeout_giro_ms: 30_000,
};

const eq = (nome: string, ip: string, extra: Partial<EquipamentoControlId> = {}): EquipamentoControlId => ({
  nome,
  ip,
  porta: 80,
  usuario: "admin",
  senha: "admin",
  sentido_entrada: "clockwise",
  ...extra,
});

const EQUIPAMENTOS: EquipamentoControlId[] = [
  eq("iDBlock da entrada", "10.0.0.5", { sentido_entrada: "anticlockwise" }),
  eq("iDAccess na catraca antiga", "10.0.0.6", { liberacao: "rele", rele: 2 }),
  eq("iDFlex com SecBox", "10.0.0.7", { liberacao: "secbox" }),
];

const abertos: { app: { close: () => Promise<unknown> }; dir: string }[] = [];
afterEach(async () => {
  for (const a of abertos.splice(0)) {
    await a.app.close();
    fs.rmSync(a.dir, { recursive: true, force: true });
  }
});

function ambiente(config: Partial<GatewayConfig> = {}) {
  const cfg = { ...BASE, controlid_equipamentos: EQUIPAMENTOS, ...config };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-liberacao-test-"));
  const cloud = new FakeCloudClient();
  cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  const gateway = new GatewayService(cfg, new ReceptorDriver("controlid"), cloud, new AlunosCache(dir), new LogsQueue(dir));
  const { app } = criarServidorReceptor(gateway, {
    host: "127.0.0.1",
    porta: 0,
    confirmacaoGiro: cfg.confirmacao_giro,
    comoLiberar: resolverComoLiberar(cfg),
  });
  abertos.push({ app, dir });
  return { app, cloud };
}

type Amb = ReturnType<typeof ambiente>;
const identificar = async (amb: Amb, ip: string) => {
  const r = await amb.app.inject({
    method: "POST",
    url: "/new_user_identified.fcgi",
    remoteAddress: ip,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ device_id: "935107", event: "7", user_id: "42", portal_id: "1", uuid: "u-1" }).toString(),
  });
  return r.json().result as { event: number; actions?: { action: string; parameters: string }[] };
};

describe("Control iD: cada equipamento libera do seu jeito", () => {
  it("iDBlock libera a borboleta no sentido de entrada dele, não no horário fixo", async () => {
    const res = await identificar(ambiente(), "10.0.0.5");
    expect(res.event).toBe(7);
    expect(res.actions).toEqual([{ action: "catra", parameters: "allow=anticlockwise" }]);
  });

  it("leitor numa catraca de outra marca fecha o relé configurado", async () => {
    const res = await identificar(ambiente(), "10.0.0.6");
    expect(res.actions).toEqual([{ action: "door", parameters: "door=2" }]);
  });

  it("iDFlex aciona o SecBox, com o motivo de acesso autorizado", async () => {
    const res = await identificar(ambiente(), "10.0.0.7");
    expect(res.actions).toEqual([{ action: "sec_box", parameters: "id=65793, reason=1" }]);
  });

  it("o IPv4 dentro de IPv6 é o mesmo equipamento", async () => {
    const res = await identificar(ambiente(), "::ffff:10.0.0.6");
    expect(res.actions?.[0].action).toBe("door");
    expect(ipDoEquipamento("::FFFF:10.0.0.6")).toBe("10.0.0.6");
  });

  it("equipamento fora da lista usa a liberação padrão do config", async () => {
    const res = await identificar(ambiente({ controlid_liberacao: "rele", controlid_rele: 1 }), "10.0.0.99");
    expect(res.actions).toEqual([{ action: "door", parameters: "door=1" }]);
    const semPadrao = await identificar(ambiente(), "10.0.0.99");
    expect(semPadrao.actions).toEqual([{ action: "catra", parameters: "allow=clockwise" }]);
  });

  it("negado não leva ação nenhuma, em qualquer modelo", async () => {
    const amb = ambiente();
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Matrícula pausada." };
    for (const ip of ["10.0.0.5", "10.0.0.6", "10.0.0.7"]) {
      const res = await identificar(amb, ip);
      expect(res.event).toBe(6);
      expect(res.actions).toBeUndefined();
    }
  });

  it("só a catraca espera o aviso de giro; o leitor não manda nenhum", async () => {
    const amb = ambiente();
    await identificar(amb, "10.0.0.5");
    await identificar(amb, "10.0.0.6");
    await identificar(amb, "10.0.0.7");
    expect(amb.cloud.opcoesRecebidas.map((o) => o.aguardarGiro ?? false)).toEqual([true, false, false]);
  });
});

describe("Control iD: liberação remota pela recepção", () => {
  const falsos: EquipamentoControlIdFalso[] = [];
  afterEach(async () => {
    for (const f of falsos.splice(0)) await f.parar();
  });

  it("relé dá o pulso; SecBox vai com o motivo de comando web; catraca respeita o sentido", async () => {
    const [catraca, rele, secbox] = [new EquipamentoControlIdFalso("c"), new EquipamentoControlIdFalso("r"), new EquipamentoControlIdFalso("s")];
    falsos.push(catraca, rele, secbox);
    for (const f of falsos) await f.iniciar();
    const gestao = new GestaoControlId([
      eq("Catraca", "127.0.0.1", { porta: catraca.porta }),
      eq("Leitor", "127.0.0.1", { porta: rele.porta, liberacao: "rele", rele: 2 }),
      eq("Flex", "127.0.0.1", { porta: secbox.porta, liberacao: "secbox" }),
    ]);
    await gestao.liberarCatraca("saida", "Catraca");
    await gestao.liberarCatraca("entrada", "Leitor");
    await gestao.liberarCatraca("ambos", "Flex");
    const acao = (f: EquipamentoControlIdFalso) =>
      (f.chamadas.find((c) => c.rota === "/execute_actions.fcgi")?.corpo.actions as { action: string; parameters: string }[])[0];
    expect(acao(catraca)).toEqual({ action: "catra", parameters: "allow=anticlockwise" });
    expect(acao(rele)).toEqual({ action: "door", parameters: "door=2" });
    expect(acao(secbox)).toEqual({ action: "sec_box", parameters: "id=65793, reason=3" });
  });

  it("acoesDeLiberacao: o sentido pedido só vale na catraca", () => {
    const rele = { liberacao: "rele" as const, sentidoEntrada: "clockwise" as const, rele: 1 as const };
    expect(acoesDeLiberacao(rele, { sentido: "both" })).toEqual([{ action: "door", parameters: "door=1" }]);
    expect(acoesDeLiberacao({ ...rele, liberacao: "catraca" }, { sentido: "both" })).toEqual([{ action: "catra", parameters: "allow=both" }]);
  });
});

describe("Control iD: configuração da liberação", () => {
  const escrever = (obj: Record<string, unknown>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-liberacao-config-"));
    const arq = path.join(dir, "config.json");
    fs.writeFileSync(arq, JSON.stringify(obj));
    return arq;
  };
  const minimo = {
    organization_id: "11111111-1111-1111-1111-111111111111",
    token_api_local: "token-valido-1234567890",
    supabase_url: "https://exemplo.supabase.co",
    catraca_ip: "10.0.0.5",
    catraca_porta: 3000,
    modelo_catraca: "controlid",
  };

  it("sem dizer nada, tudo é catraca com entrada no horário, como antes", () => {
    const c = carregarConfig(escrever({ ...minimo, controlid_equipamentos: [{ nome: "A", ip: "10.0.0.5", senha: "x" }] }));
    expect(c.controlid_liberacao).toBe("catraca");
    expect(c.controlid_sentido_entrada).toBe("clockwise");
    expect(c.controlid_equipamentos?.[0]).toMatchObject({ liberacao: "catraca", rele: 1 });
  });

  it("jeito de liberar desconhecido é recusado na subida", () => {
    expect(() => carregarConfig(escrever({ ...minimo, controlid_liberacao: "porta" }))).toThrow();
    expect(() =>
      carregarConfig(escrever({ ...minimo, controlid_equipamentos: [{ nome: "A", ip: "10.0.0.5", senha: "x", rele: 3 }] }))
    ).toThrow();
  });
});

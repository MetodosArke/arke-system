import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { MockDriver } from "../src/drivers/MockDriver";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { GatewayConfig } from "../src/types";

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 3000,
  modelo_catraca: "mock",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
};

function criarAmbiente() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-gateway-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const driver = new MockDriver();
  const gateway = new GatewayService(CONFIG, driver, cloud, alunosCache, logsQueue);
  return { dataDir, alunosCache, logsQueue, cloud, driver, gateway };
}

describe("GatewayService — payload de sucesso (online)", () => {
  let ambiente: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    ambiente = criarAmbiente();
  });

  afterEach(() => {
    fs.rmSync(ambiente.dataDir, { recursive: true, force: true });
  });

  it("libera o acesso quando a nuvem responde liberado=true dentro do timeout", async () => {
    ambiente.cloud.respostaValidarAcesso = {
      liberado: true,
      motivo: "Acesso liberado.",
      aluno_nome: "Maria Teste",
    };

    const resultado = await ambiente.gateway.validarAcesso("12345678900");

    expect(resultado.liberado).toBe(true);
    expect(resultado.nomeAluno).toBe("Maria Teste");
    expect(resultado.validadoOffline).toBe(false);
    expect(ambiente.gateway.getStatus()).toBe("online");
  });

  it("nega o acesso quando a nuvem responde liberado=false (ex.: inadimplente)", async () => {
    ambiente.cloud.respostaValidarAcesso = { liberado: false, motivo: "Assinatura em atraso." };

    const resultado = await ambiente.gateway.validarAcesso("12345678900");

    expect(resultado.liberado).toBe(false);
    expect(resultado.mensagem).toBe("Assinatura em atraso.");
    expect(resultado.validadoOffline).toBe(false);
  });

  it("processarLeitura aciona liberarAcesso no driver quando liberado", async () => {
    ambiente.cloud.respostaValidarAcesso = { liberado: true, motivo: "Acesso liberado.", aluno_nome: "João" };
    const liberados: string[] = [];
    ambiente.driver.liberarAcesso = async (nome: string) => {
      liberados.push(nome);
    };
    await ambiente.driver.conectar();

    await ambiente.gateway.processarLeitura({ tipo: "cpf", valor: "123.456.789-00", lidoEm: new Date() });

    expect(liberados).toEqual(["João"]);
  });
});

describe("GatewayService — fallback offline (contingência)", () => {
  let ambiente: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    ambiente = criarAmbiente();
  });

  afterEach(() => {
    fs.rmSync(ambiente.dataDir, { recursive: true, force: true });
  });

  it("cai para o cache local quando a nuvem estoura o timeout e libera um aluno em dia", async () => {
    ambiente.cloud.erroValidarAcesso = Object.assign(new Error("timeout of 300ms exceeded"), { code: "ECONNABORTED" });
    await ambiente.alunosCache.substituirTodos([
      { aluno_id: "aluno-1", cpf: "12345678900", nome: "Pedro Offline", inadimplente: false },
    ]);

    const resultado = await ambiente.gateway.validarAcesso("12345678900");

    expect(resultado.liberado).toBe(true);
    expect(resultado.validadoOffline).toBe(true);
    expect(resultado.nomeAluno).toBe("Pedro Offline");
    expect(ambiente.gateway.getStatus()).toBe("contingencia");
  });

  it("nega pelo cache local quando o aluno está inadimplente", async () => {
    ambiente.cloud.erroValidarAcesso = new Error("network error");
    await ambiente.alunosCache.substituirTodos([
      { aluno_id: "aluno-2", cpf: "11122233344", nome: "Ana Atrasada", inadimplente: true },
    ]);

    const resultado = await ambiente.gateway.validarAcesso("11122233344");

    expect(resultado.liberado).toBe(false);
    expect(resultado.validadoOffline).toBe(true);
  });

  it("nega e marca status offline quando o cache local também está vazio", async () => {
    ambiente.cloud.erroValidarAcesso = new Error("network error");

    const resultado = await ambiente.gateway.validarAcesso("00000000000");

    expect(resultado.liberado).toBe(false);
    expect(resultado.validadoOffline).toBe(true);
    expect(ambiente.gateway.getStatus()).toBe("offline");
  });

  it("enfileira o acesso offline em logsQueue para sincronizar depois", async () => {
    ambiente.cloud.erroValidarAcesso = new Error("network error");
    await ambiente.alunosCache.substituirTodos([
      { aluno_id: "aluno-3", cpf: "99988877766", nome: "Carla", inadimplente: false },
    ]);
    await ambiente.driver.conectar();

    await ambiente.gateway.processarLeitura({ tipo: "cpf", valor: "999.888.777-66", lidoEm: new Date() });

    const pendentes = await ambiente.logsQueue.listarPendentes();
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0].cpf_consultado).toBe("99988877766");
    expect(pendentes[0].resultado).toBe("liberado");
  });

  it("flushLogsPendentes envia os logs offline para a nuvem e marca como sincronizados", async () => {
    await ambiente.logsQueue.adicionar({
      aluno_id: "aluno-4",
      cpf_consultado: "55566677788",
      resultado: "liberado",
      ocorrido_em: new Date().toISOString(),
      sincronizado: false,
    });

    await ambiente.gateway.flushLogsPendentes();

    expect(ambiente.cloud.logsRecebidos).toHaveLength(1);
    expect(await ambiente.logsQueue.contarPendentes()).toBe(0);
  });

  it("mantém os logs pendentes se a sincronização falhar", async () => {
    ambiente.cloud.erroSincronizarLogs = new Error("cloud indisponível");
    await ambiente.logsQueue.adicionar({
      aluno_id: "aluno-5",
      cpf_consultado: "12312312312",
      resultado: "liberado",
      ocorrido_em: new Date().toISOString(),
      sincronizado: false,
    });

    await ambiente.gateway.flushLogsPendentes();

    expect(await ambiente.logsQueue.contarPendentes()).toBe(1);
  });
});

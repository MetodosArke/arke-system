import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import {
  registrarReceptorTopdata,
  sentidoPorOrigem,
  ORIGEM_TOPDATA,
} from "../src/receptores/topdata";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { GatewayConfig } from "../src/types";

/**
 * Estes testes exercitam o contrato entre o gateway e a ponte .NET que
 * possui a EasyInner.dll.
 *
 * Vale explicar por que este contrato PODE ser testado assim, enquanto um
 * driver Topdata escrito contra protocolo binário adivinhado não podia: o
 * vocabulário de eventos (a tabela de Origens) vem transcrito do manual
 * oficial do SDK, e o formato da conversa gateway↔ponte é nosso — nós
 * escrevemos os dois lados. O que fala com o hardware é a DLL do
 * fabricante, que não estamos reimplementando.
 *
 * O que continua fora de alcance sem bancada: comportamento real da DLL,
 * timing do giro e qual leitor físico é a entrada.
 */

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 3570,
  modelo_catraca: "topdata",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
};

function criarAmbiente(leitorDeEntrada: 1 | 2 = 1) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-topdata-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("topdata"), cloud, alunosCache, logsQueue);
  const app = Fastify({ logger: false });
  registrarReceptorTopdata(app, gateway, { leitorDeEntrada });
  return { dataDir, alunosCache, cloud, app };
}

function comoAPonte(app: ReturnType<typeof criarAmbiente>["app"], corpo: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/topdata/evento", payload: corpo });
}

describe("sentidoPorOrigem", () => {
  it("mapeia os leitores para entrada e saída", () => {
    expect(sentidoPorOrigem(ORIGEM_TOPDATA.LEITOR1, 1)).toBe("entrada");
    expect(sentidoPorOrigem(ORIGEM_TOPDATA.LEITOR2, 1)).toBe("saida");
  });

  it("inverte quando a instalação usa o leitor 2 como entrada", () => {
    // Qual leitor é a entrada depende de como a catraca foi parafusada —
    // o manual deixa isso a cargo de ConfigurarLeitor1/2.
    expect(sentidoPorOrigem(ORIGEM_TOPDATA.LEITOR1, 2)).toBe("saida");
    expect(sentidoPorOrigem(ORIGEM_TOPDATA.LEITOR2, 2)).toBe("entrada");
  });

  it("libera nos dois sentidos quando a origem não diz o lado", () => {
    // Biometria, QR e teclado não informam por onde a pessoa veio. Deixar
    // o equipamento resolver é melhor do que chutarmos um sentido.
    for (const origem of [ORIGEM_TOPDATA.SENSOR_BIOMETRICO, ORIGEM_TOPDATA.QRCODE, ORIGEM_TOPDATA.TECLADO]) {
      expect(sentidoPorOrigem(origem, 1)).toBe("ambos");
    }
  });
});

describe("Receptor Topdata — decisão de acesso", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("libera pela entrada quando o leitor 1 lê um cartão autorizado", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    const corpo = (
      await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" })
    ).json();

    expect(corpo.liberar).toBe(true);
    expect(corpo.sentido).toBe("entrada");
    expect(corpo.nome).toBe("Jean Ramos");
  });

  it("trata biometria como identificador do equipamento, não como CPF", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.SENSOR_BIOMETRICO, valor: "6" });

    // Mesmo desenho da Control iD: a digital foi comparada dentro do
    // equipamento e o que viaja é o número do usuário nele.
    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "6" }]);
  });

  it("trata 11 dígitos no teclado como CPF", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    // Em academia, o que se digita no teclado costuma ser o CPF.
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.TECLADO, valor: "529.982.247-25" });

    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "cpf", valor: "52998224725" }]);
  });

  it("não confunde senha curta digitada com CPF", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true };

    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.TECLADO, valor: "1234" });

    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "1234" }]);
  });

  it("nega sem sentido de giro quando a nuvem recusa", async () => {
    amb.cloud.respostaValidarAcesso = {
      liberado: false,
      motivo: "Mensalidade da academia em atraso.",
      aluno_nome: "Jean Ramos",
    };

    const corpo = (
      await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" })
    ).json();

    expect(corpo.liberar).toBe(false);
    expect(corpo.sentido).toBeUndefined();
    // O nome vai junto para o display dizer a quem está negando.
    expect(corpo.nome).toBe("Jean Ramos");
    expect(corpo.motivo).toContain("atraso");
  });

  it("recusa leitura vazia sem consultar a nuvem", async () => {
    const corpo = (await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "" })).json();

    expect(corpo.liberar).toBe(false);
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });
});

describe("Receptor Topdata — eventos que encerram o ciclo", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("reconhece o giro confirmado sem tentar validar de novo", async () => {
    const corpo = (await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO })).json();

    expect(corpo.motivo).toBe("giro_confirmado");
    // Revalidar aqui gastaria uma ida à nuvem por giro, e um "negado"
    // apareceria no display depois de a pessoa já ter passado.
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });

  it("reconhece o tempo de liberação expirado sem giro", async () => {
    const corpo = (
      await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.FIM_TEMPO_ACIONAMENTO })
    ).json();

    expect(corpo.motivo).toBe("giro_nao_ocorreu");
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });

  it("aceita o sinal de vida da ponte", async () => {
    const resp = await amb.app.inject({
      method: "POST",
      url: "/topdata/ponte-viva",
      payload: { inners: [1, 2] },
    });
    expect(resp.statusCode).toBe(200);
  });
});

describe("Receptor Topdata — contingência", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("decide pelo cache local quando a nuvem cai", async () => {
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "aluno-1",
        cpf: "11111111111",
        nome: "Jean Ramos",
        inadimplente: false,
        identificador_catraca: "6",
      },
    ]);

    const corpo = (
      await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.SENSOR_BIOMETRICO, valor: "6" })
    ).json();

    expect(corpo.liberar).toBe(true);
    expect(corpo.sentido).toBe("ambos");
  });

  it("nega quem não está no cache — fail-closed, igual à Control iD", async () => {
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");

    const corpo = (
      await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000999" })
    ).json();

    expect(corpo.liberar).toBe(false);
  });
});

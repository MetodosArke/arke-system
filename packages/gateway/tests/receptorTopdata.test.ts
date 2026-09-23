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
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

function criarAmbiente(leitorDeEntrada: 1 | 2 = 1, timeoutGiroMs = 30_000) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-topdata-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("topdata"), cloud, alunosCache, logsQueue);
  const app = Fastify({ logger: false });
  registrarReceptorTopdata(app, gateway, { leitorDeEntrada, timeoutGiroMs });
  return { dataDir, alunosCache, logsQueue, cloud, app };
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

describe("Receptor Topdata — giro vira presença ou desistência", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos", log_id: "log-1" };
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("pede à nuvem para aguardar o giro — a Topdata sempre avisa", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    expect(amb.cloud.opcoesRecebidas).toEqual([{ aguardarGiro: true }]);
  });

  it("giro (origem 6) confirma o acesso daquele Inner", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO });
    await new Promise((r) => setImmediate(r));
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "confirmado" }]);
  });

  it("tempo esgotado (origem 5) fecha como desistência — não vira presença", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.FIM_TEMPO_ACIONAMENTO });
    await new Promise((r) => setImmediate(r));
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "desistencia" }]);
  });

  it("aviso de outro Inner não fecha o acesso errado", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    await comoAPonte(amb.app, { inner: 2, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO });
    await new Promise((r) => setImmediate(r));
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });

  it("leitura nova antes do aviso fecha a anterior como sem confirmação", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-2" };
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000456" });
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO });
    await new Promise((r) => setImmediate(r));
    expect(amb.cloud.girosConfirmados).toEqual([
      { logId: "log-1", giro: "sem_confirmacao" },
      { logId: "log-2", giro: "confirmado" },
    ]);
  });

  it("sem aviso nenhum, o prazo fecha como sem confirmação", async () => {
    await amb.app.close();
    amb = criarAmbiente(1, 30);
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos", log_id: "log-1" };
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    await new Promise((r) => setTimeout(r, 80));
    expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "sem_confirmacao" }]);
  });

  it("negado não fica esperando giro", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Matrícula pausada." };
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "000123" });
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO });
    await new Promise((r) => setImmediate(r));
    expect(amb.cloud.girosConfirmados).toEqual([]);
  });
});

describe("Receptor Topdata — contingência guarda o acesso", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(async () => {
    amb = criarAmbiente();
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");
    await amb.alunosCache.substituirTodos([
      { aluno_id: "aluno-1", cpf: "11111111111", nome: "Jean Ramos", inadimplente: false, identificador_catraca: "6" },
    ]);
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("liberado pelo cache entra na fila com giro pendente, e o giro o fecha", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.SENSOR_BIOMETRICO, valor: "6" });
    let fila = await amb.logsQueue.listarPendentes();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ aluno_id: "aluno-1", resultado: "liberado", giro: "pendente", cpf_consultado: "id:6" });

    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.GIRO_CONFIRMADO });
    await new Promise((r) => setTimeout(r, 20));
    fila = await amb.logsQueue.listarPendentes();
    expect(fila[0].giro).toBe("confirmado");
  });

  it("negado pelo cache também fica registrado, sem giro", async () => {
    await comoAPonte(amb.app, { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "999" });
    const fila = await amb.logsQueue.listarPendentes();
    expect(fila).toHaveLength(1);
    expect(fila[0].resultado).toBe("negado_nao_encontrado");
    expect(fila[0].giro).toBeUndefined();
  });
});

describe("Receptor Topdata — bilhetes e segurança", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(async () => {
    amb = criarAmbiente();
    await amb.alunosCache.substituirTodos([
      { aluno_id: "aluno-1", cpf: "11111111111", nome: "Jean Ramos", inadimplente: false, identificador_catraca: "777" },
    ]);
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("bilhete guardado pela catraca vira passagem com giro confirmado, na hora em que aconteceu", async () => {
    const resp = await amb.app.inject({
      method: "POST",
      url: "/topdata/bilhetes",
      payload: {
        inner: 1,
        bilhetes: [
          { tipo: 10, valor: "777", ocorrido_em: "2026-09-22T18:45:00-03:00" },
          { tipo: 10, valor: "000", ocorrido_em: "2026-09-22T18:50:00-03:00" },
        ],
      },
    });
    expect(resp.json()).toEqual({ registrados: 2 });
    // Sobe para a nuvem na hora, sem esperar o ciclo de 30 s.
    await new Promise((r) => setTimeout(r, 30));
    const subiu = amb.cloud.logsRecebidos;
    const doAluno = subiu.find((l) => l.aluno_id === "aluno-1");
    expect(doAluno).toMatchObject({ resultado: "liberado", giro: "confirmado", ocorrido_em: "2026-09-22T18:45:00-03:00" });
    // Identificador desconhecido sobe para auditoria, sem virar presença de ninguém.
    expect(subiu.find((l) => l.cpf_consultado === "id:000")?.aluno_id).toBeNull();
  });

  it("rotas da ponte recusam quem não é a própria máquina", async () => {
    for (const url of ["/topdata/evento", "/topdata/bilhetes", "/topdata/ponte-viva"]) {
      const resp = await amb.app.inject({
        method: "POST",
        url,
        remoteAddress: "192.168.0.50",
        payload: { inner: 1, origem: ORIGEM_TOPDATA.LEITOR1, valor: "777" },
      });
      expect(resp.statusCode, url).toBe(403);
    }
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });
});

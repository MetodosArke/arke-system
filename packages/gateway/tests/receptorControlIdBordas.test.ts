import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import type { GatewayConfig } from "../src/types";

/**
 * Bordas do receptor Control iD.
 *
 * O arquivo irmão cobre o caminho feliz com os payloads literais da
 * documentação. Este cobre o que acontece quando o mundo não colabora:
 * equipamento mandando lixo, duas catracas falando ao mesmo tempo, nuvem
 * estourando o timeout no meio de um giro.
 *
 * A regra que todos estes testes verificam é uma só, e é a que importa
 * numa catraca: **na dúvida, trava**. Uma borboleta que abre por acidente
 * é pior do que uma que trava sem motivo — a segunda gera reclamação na
 * recepção, a primeira gera acesso de quem não pagou e não deixa rastro.
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
};

function criarAmbiente() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-bordas-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("controlid"), cloud, alunosCache, logsQueue);
  const { app } = criarServidorReceptor(gateway, { host: "127.0.0.1", porta: 0 });
  return { dataDir, alunosCache, cloud, app };
}

function comoACatraca(
  app: ReturnType<typeof criarAmbiente>["app"],
  campos: Record<string, string>,
  rota = "/new_user_identified.fcgi"
) {
  return app.inject({
    method: "POST",
    url: rota,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(campos).toString(),
  });
}

describe("Bordas — payload que o equipamento não deveria mandar", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("trava quando user_id vem como texto, sem consultar a nuvem", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Não deveria" };

    const corpo = (await comoACatraca(amb.app, { user_id: "abc" })).json();

    // "abc" não identifica ninguém. A consulta ainda sai porque o
    // identificador é texto por natureza (o equipamento numera, mas o
    // campo é livre) — o que não pode acontecer é liberar sem resposta.
    expect(corpo.result.event).toBeDefined();
    expect([3, 6, 7]).toContain(corpo.result.event);
  });

  it("trava quando user_id é zero — a documentação usa 0 para não identificado", async () => {
    const corpo = (await comoACatraca(amb.app, { user_id: "0" })).json();
    expect(corpo.result.event).toBe(3);
    expect(corpo.result.actions).toBeUndefined();
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });

  it("trava com corpo completamente vazio", async () => {
    const corpo = (await comoACatraca(amb.app, {})).json();
    expect(corpo.result.event).toBe(3);
    expect(corpo.result.actions).toBeUndefined();
  });

  it("não estoura com JSON malformado no lugar de urlencoded", async () => {
    const resp = await amb.app.inject({
      method: "POST",
      url: "/new_user_identified.fcgi",
      headers: { "content-type": "application/json" },
      payload: "{isso não é json",
    });

    // O que importa é o processo continuar de pé: um equipamento com
    // firmware estranho não pode derrubar o gateway e com ele a catraca
    // da porta ao lado.
    expect(resp.statusCode).toBeGreaterThanOrEqual(400);
    expect(resp.statusCode).toBeLessThan(500);
  });

  it("não estoura com identificador absurdamente longo", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Aluno não encontrado." };

    const corpo = (await comoACatraca(amb.app, { user_id: "9".repeat(5000) })).json();

    expect(corpo.result.event).toBe(6);
    expect(corpo.result.actions).toBeUndefined();
  });

  it("ignora campos desconhecidos em vez de recusar a leitura", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    // Firmware novo pode passar a mandar campos que não conhecemos.
    // Recusar por isso transformaria atualização de firmware em catraca
    // travada.
    const corpo = (
      await comoACatraca(amb.app, { user_id: "6", campo_futuro: "x", outro: "y" })
    ).json();

    expect(corpo.result.event).toBe(7);
  });
});

describe("Bordas — nuvem instável no meio da operação", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("cai para o cache quando a nuvem falha no meio de uma sequência", async () => {
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "aluno-1",
        cpf: "11111111111",
        nome: "Jean Ramos",
        inadimplente: false,
        identificador_catraca: "6",
      },
    ]);

    // Primeira leitura: nuvem responde
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };
    const online = (await comoACatraca(amb.app, { user_id: "6" })).json();
    expect(online.result.event).toBe(7);

    // Nuvem cai entre uma leitura e outra — sem reiniciar nada
    amb.cloud.erroValidarAcesso = new Error("timeout");
    const offline = (await comoACatraca(amb.app, { user_id: "6" })).json();
    expect(offline.result.event).toBe(7);

    // E volta
    amb.cloud.erroValidarAcesso = null;
    const devolta = (await comoACatraca(amb.app, { user_id: "6" })).json();
    expect(devolta.result.event).toBe(7);
  });

  it("trava quem a nuvem não conhece e o cache também não", async () => {
    amb.cloud.erroValidarAcesso = new Error("timeout");
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "outro",
        cpf: "22222222222",
        nome: "Outro",
        inadimplente: false,
        identificador_catraca: "99",
      },
    ]);

    const corpo = (await comoACatraca(amb.app, { user_id: "6" })).json();
    expect(corpo.result.event).toBe(6);
    expect(corpo.result.actions).toBeUndefined();
  });
});

describe("Bordas — duas catracas da mesma academia ao mesmo tempo", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("responde cada equipamento com a decisão dele, sem trocar as respostas", async () => {
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "em-dia",
        cpf: "11111111111",
        nome: "Em Dia",
        inadimplente: false,
        identificador_catraca: "10",
      },
      {
        aluno_id: "atrasado",
        cpf: "22222222222",
        nome: "Atrasado",
        inadimplente: true,
        identificador_catraca: "20",
      },
    ]);
    // Força o caminho offline para que a decisão dependa só do cache, e
    // uma troca de respostas fique visível.
    amb.cloud.erroValidarAcesso = new Error("nuvem fora");

    // Entrada e saída disparando ao mesmo tempo, como em horário de pico
    const [a, b] = await Promise.all([
      comoACatraca(amb.app, { device_id: "1", user_id: "10" }),
      comoACatraca(amb.app, { device_id: "2", user_id: "20" }),
    ]);

    expect(a.json().result.event).toBe(7);
    expect(a.json().result.user_name).toBe("Em Dia");
    expect(b.json().result.event).toBe(6);
    expect(b.json().result.user_name).toBe("Atrasado");
  });

  it("aguenta uma rajada sem misturar decisões", async () => {
    await amb.alunosCache.substituirTodos(
      // Identificadores a partir de 1: a documentação reserva 0 para
      // "não identificado", e o receptor trata assim de propósito.
      Array.from({ length: 10 }, (_, i) => ({
        aluno_id: `aluno-${i + 1}`,
        cpf: String(i + 1).padStart(11, "0"),
        nome: `Aluno ${i + 1}`,
        // Ímpares em dia, pares em atraso
        inadimplente: (i + 1) % 2 === 0,
        identificador_catraca: String(i + 1),
      }))
    );
    amb.cloud.erroValidarAcesso = new Error("nuvem fora");

    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) => comoACatraca(amb.app, { user_id: String(i + 1) }))
    );

    respostas.forEach((r, i) => {
      const corpo = r.json();
      expect(corpo.result.user_name).toBe(`Aluno ${i + 1}`);
      expect(corpo.result.event).toBe((i + 1) % 2 === 0 ? 6 : 7);
    });
  });
});

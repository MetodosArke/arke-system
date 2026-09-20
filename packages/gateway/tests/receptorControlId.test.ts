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
 * Estes testes simulam a catraca Control iD.
 *
 * Como o equipamento fala HTTP com payload documentado, dá para exercitar
 * o caminho inteiro sem hardware: montamos exatamente a requisição que a
 * documentação do fabricante diz que o aparelho envia, e conferimos o JSON
 * que devolvemos. Não substitui bancada — timing de giro, ergonomia do
 * cadastro e variação de firmware só a catraca física responde — mas é
 * verificação real do protocolo e da regra de negócio, e é o que distingue
 * isto dos drivers-stub que existiam antes.
 *
 * Payloads conforme:
 * https://www.controlid.com.br/docs/access-api-pt/modos-de-operacao/eventos-de-identificacao-online/
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-receptor-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("controlid"), cloud, alunosCache, logsQueue);
  const { app } = criarServidorReceptor(gateway, { host: "127.0.0.1", porta: 0 });
  return { dataDir, alunosCache, cloud, gateway, app };
}

/** Monta a requisição do jeito que o equipamento monta: urlencoded. */
function comoACatraca(
  app: ReturnType<typeof criarAmbiente>["app"],
  rota: string,
  campos: Record<string, string>
) {
  return app.inject({
    method: "POST",
    url: rota,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(campos).toString(),
  });
}

describe("Receptor Control iD — modo Pro (biometria identificada no equipamento)", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("libera o giro quando a nuvem autoriza, devolvendo event 7 e a ação catra", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    const resp = await comoACatraca(amb.app, "/new_user_identified.fcgi", {
      device_id: "1",
      user_id: "6",
      event: "7",
      portal_id: "1",
    });

    expect(resp.statusCode).toBe(200);
    const corpo = resp.json();
    expect(corpo.result.event).toBe(7);
    expect(corpo.result.user_name).toBe("Jean Ramos");
    expect(corpo.result.actions).toEqual([{ action: "catra", parameters: "allow=clockwise" }]);
  });

  it("envia à nuvem o identificador do equipamento, não um CPF", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Jean Ramos" };

    await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "42" });

    // O ponto central do desenho: a digital foi comparada dentro da
    // catraca, e o que viajou pela rede foi só o número do usuário.
    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "42" }]);
  });

  it("mantém a borboleta travada quando a nuvem nega, sem ação de giro", async () => {
    amb.cloud.respostaValidarAcesso = {
      liberado: false,
      motivo: "Mensalidade em atraso",
      aluno_nome: "Jean Ramos",
    };

    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "6" })).json();

    expect(corpo.result.event).toBe(6);
    expect(corpo.result.actions).toBeUndefined();
    // O nome vai mesmo na negativa: o display diz a quem está negando, e a
    // recepção resolve na hora em vez de o aluno ficar sem explicação.
    expect(corpo.result.user_name).toBe("Jean Ramos");
  });

  it("responde não-identificado quando o equipamento manda evento sem user_id", async () => {
    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { device_id: "1" })).json();
    expect(corpo.result.event).toBe(3);
    expect(corpo.result.actions).toBeUndefined();
  });

  it("nega cartão e QR Code, que ainda não têm mapeamento para aluno", async () => {
    const cartao = (await comoACatraca(amb.app, "/new_card.fcgi", { card_value: "123456" })).json();
    const qr = (await comoACatraca(amb.app, "/new_qrcode.fcgi", { qrcode_value: "ABC" })).json();

    // Negar com log é a mesma disciplina que o gateway já aplicava: não
    // fingir que valida o que não sabe resolver.
    expect(cartao.result.event).toBe(3);
    expect(qr.result.event).toBe(3);
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(0);
  });
});

describe("Receptor Control iD — contingência", () => {
  let amb: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    amb = criarAmbiente();
  });

  afterEach(async () => {
    await amb.app.close();
    fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  it("responde 200 ao device_is_alive, que é o que tira a catraca da contingência", async () => {
    const resp = await amb.app.inject({
      method: "POST",
      url: "/device_is_alive.fcgi",
      headers: { "content-type": "application/json" },
      payload: { access_logs: 12 },
    });
    expect(resp.statusCode).toBe(200);
  });

  it("libera pelo cache local quando a nuvem cai, buscando pelo identificador", async () => {
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

    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "6" })).json();

    expect(corpo.result.event).toBe(7);
    expect(corpo.result.actions).toEqual([{ action: "catra", parameters: "allow=clockwise" }]);
  });

  it("nega pelo cache local quando o aluno está inadimplente", async () => {
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "aluno-1",
        cpf: "11111111111",
        nome: "Jean Ramos",
        inadimplente: true,
        identificador_catraca: "6",
      },
    ]);

    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "6" })).json();
    expect(corpo.result.event).toBe(6);
    expect(corpo.result.actions).toBeUndefined();
  });

  it("nega quem não está no cache — fail-closed, nunca fail-open", async () => {
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");
    await amb.alunosCache.substituirTodos([
      {
        aluno_id: "aluno-1",
        cpf: "11111111111",
        nome: "Outro",
        inadimplente: false,
        identificador_catraca: "99",
      },
    ]);

    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "6" })).json();
    expect(corpo.result.event).toBe(6);
  });

  it("nega tudo quando a nuvem caiu e o cache ainda está vazio", async () => {
    amb.cloud.erroValidarAcesso = new Error("nuvem indisponível");

    const corpo = (await comoACatraca(amb.app, "/new_user_identified.fcgi", { user_id: "6" })).json();
    expect(corpo.result.event).toBe(6);
    expect(corpo.result.actions).toBeUndefined();
  });
});

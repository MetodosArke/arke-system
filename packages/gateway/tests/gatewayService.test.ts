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
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
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
    // Nuvem antiga ainda manda o nome; o Gateway não o carrega para lugar nenhum.
    expect(JSON.stringify(resultado)).not.toContain("Maria");
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

  it("processarLeitura libera com a frase pública do display, nunca com o nome", async () => {
    ambiente.cloud.respostaValidarAcesso = { liberado: true, motivo: "Acesso liberado.", aluno_nome: "João" };
    const liberados: string[] = [];
    ambiente.driver.liberarAcesso = async (mensagem: string) => {
      liberados.push(mensagem);
    };
    await ambiente.driver.conectar();

    await ambiente.gateway.processarLeitura({ tipo: "cpf", valor: "123.456.789-00", lidoEm: new Date() });

    expect(liberados).toEqual(["Bem-vindo!"]);
  });

  it("processarLeitura nega sem falar de dinheiro no display", async () => {
    ambiente.cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade da academia em atraso.", aluno_nome: "João" };
    const negados: string[] = [];
    ambiente.driver.negarAcesso = async (motivo: string) => {
      negados.push(motivo);
    };
    await ambiente.driver.conectar();

    await ambiente.gateway.processarLeitura({ tipo: "cpf", valor: "123.456.789-00", lidoEm: new Date() });

    expect(negados).toEqual(["Fale c/ recepcao"]);
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
    expect(resultado.alunoId).toBe("aluno-1");
    expect(JSON.stringify(resultado)).not.toContain("Pedro");
    expect(ambiente.gateway.getStatus()).toBe("contingencia");
  });

  it("nega pelo cache local quando o aluno está inadimplente, sem falar de dinheiro", async () => {
    ambiente.cloud.erroValidarAcesso = new Error("network error");
    await ambiente.alunosCache.substituirTodos([
      { aluno_id: "aluno-2", cpf: "11122233344", nome: "Ana Atrasada", inadimplente: true },
    ]);
    await ambiente.driver.conectar();

    const resultado = await ambiente.gateway.validarAcesso("11122233344");

    expect(resultado.liberado).toBe(false);
    expect(resultado.validadoOffline).toBe(true);
    expect(resultado.mensagem.toLowerCase()).not.toMatch(/atraso|mensalidade|assinatura/);

    // E o registro sobe como inadimplente, pelo resultado explícito, não pelo texto.
    await ambiente.gateway.processarLeitura({ tipo: "cpf", valor: "111.222.333-44", lidoEm: new Date() });
    const [pendente] = await ambiente.logsQueue.listarPendentes();
    expect(pendente.resultado).toBe("negado_inadimplente");
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

/** Um acesso da contingência, do jeito que o Gateway guarda. */
const acesso = (aluno_id: string | null, ocorrido_em = new Date().toISOString()) => ({
  aluno_id,
  cpf_consultado: aluno_id ? `id:${aluno_id}` : "52998224725",
  resultado: "liberado" as const,
  ocorrido_em,
  sincronizado: false,
});

describe("GatewayService — a fila de acessos offline anda", () => {
  let ambiente: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    ambiente = criarAmbiente();
  });

  afterEach(() => {
    fs.rmSync(ambiente.dataDir, { recursive: true, force: true });
  });

  it("cada registro vai com o id local", async () => {
    const id = await ambiente.logsQueue.adicionar(acesso("aluno-1"));
    await ambiente.gateway.flushLogsPendentes();
    expect(ambiente.cloud.logsRecebidos[0].id_local).toBe(id);
  });

  it("registro recusado de vez sai da fila e não trava os outros", async () => {
    // O defeito de antes: um aluno excluído durante a queda derrubava o lote
    // inteiro, e o Gateway reenviava os mesmos 500 a cada 30 s, para sempre.
    await ambiente.logsQueue.adicionar(acesso("aluno-excluido"));
    await ambiente.logsQueue.adicionar(acesso("aluno-2"));
    ambiente.cloud.descartarLog = (l) => (l.aluno_id === "aluno-excluido" ? "aluno não é desta academia" : null);

    const aceitos = await ambiente.gateway.enviarLogsPendentes();

    expect(aceitos).toBe(1);
    expect(await ambiente.logsQueue.contarPendentes()).toBe(0);
    await ambiente.gateway.flushLogsPendentes();
    expect(ambiente.cloud.logsRecebidos.map((l) => l.aluno_id)).toEqual(["aluno-2"]);
  });

  it("o que a nuvem não citar fica para a próxima tentativa", async () => {
    await ambiente.logsQueue.adicionar(acesso("aluno-1"));
    await ambiente.logsQueue.adicionar(acesso("aluno-2"));
    ambiente.cloud.deixarDeFora = (l) => l.aluno_id === "aluno-2";

    await ambiente.gateway.enviarLogsPendentes();

    const fila = await ambiente.logsQueue.listarPendentes();
    expect(fila.map((l) => l.aluno_id)).toEqual(["aluno-2"]);
  });

  it("nuvem antiga, sem a lista: o 200 vale para todos, como antes", async () => {
    ambiente.cloud.modoLogs = "antiga";
    await ambiente.logsQueue.adicionar(acesso("aluno-1"));
    await ambiente.logsQueue.adicionar(acesso("aluno-2"));

    expect(await ambiente.gateway.enviarLogsPendentes()).toBe(2);
    expect(await ambiente.logsQueue.contarPendentes()).toBe(0);
  });
});

describe("GatewayService — o que fica no computador da recepção", () => {
  let ambiente: ReturnType<typeof criarAmbiente>;

  beforeEach(() => {
    ambiente = criarAmbiente();
  });

  afterEach(() => {
    fs.rmSync(ambiente.dataDir, { recursive: true, force: true });
  });

  const arquivo = (nome: string) => fs.readFileSync(path.join(ambiente.dataDir, nome), "utf8");

  it("acesso entregue à nuvem sai depois de 30 dias, e o arquivo é reescrito", async () => {
    const agora = new Date("2026-10-06T12:00:00Z");
    const antigo = await ambiente.logsQueue.adicionar(acesso(null, "2026-08-20T12:00:00Z"));
    const recente = await ambiente.logsQueue.adicionar(acesso("aluno-1", "2026-10-01T12:00:00Z"));
    await ambiente.logsQueue.adicionar(acesso("aluno-pendente", "2026-08-01T12:00:00Z"));
    await ambiente.logsQueue.marcarSincronizados([antigo], new Date("2026-08-21T12:00:00Z"));
    await ambiente.logsQueue.marcarSincronizados([recente], new Date("2026-10-02T12:00:00Z"));

    expect(await ambiente.gateway.aplicarRetencao(agora)).toBe(1);

    // O pendente nunca sai, por mais velho que seja: ainda não subiu.
    expect(await ambiente.logsQueue.contarTodos()).toBe(2);
    expect(await ambiente.logsQueue.contarPendentes()).toBe(1);
    // O NeDB só acrescenta linhas: sem reescrever, o CPF continuaria no disco.
    expect(arquivo("logs-pendentes.db")).not.toContain("52998224725");
  });

  it("registro de antes da 1.9, sem a data da entrega, vale pela data do acesso", async () => {
    const id = await ambiente.logsQueue.adicionar(acesso(null, "2026-08-01T12:00:00Z"));
    await ambiente.logsQueue.marcarSincronizados([id]);
    // Simula o registro antigo: sincronizado, sem `sincronizado_em`.
    await (ambiente.logsQueue as unknown as { db: { update: (q: object, u: object) => Promise<number> } }).db.update(
      { _id: id },
      { $unset: { sincronizado_em: true } }
    );

    expect(await ambiente.gateway.aplicarRetencao(new Date("2026-10-06T12:00:00Z"))).toBe(1);
  });

  it("o cache de alunos não guarda o nome, e quem sai do cache sai do arquivo", async () => {
    await ambiente.alunosCache.substituirTodos([
      { aluno_id: "a-1", cpf: "52998224725", nome: "Ana Saiu", inadimplente: false, identificador_catraca: "7" },
      { aluno_id: "a-2", cpf: "11144477735", nome: "Bia Fica", inadimplente: false },
    ]);
    expect(arquivo("alunos-cache.db")).not.toContain("Ana Saiu");

    await ambiente.alunosCache.aplicarDiferenca([], ["a-1"]);

    expect(await ambiente.alunosCache.contar()).toBe(1);
    expect(arquivo("alunos-cache.db")).not.toContain("52998224725");
    expect(arquivo("alunos-cache.db")).toContain("11144477735");
  });
});

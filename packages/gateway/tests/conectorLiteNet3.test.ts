import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { ConectorToletus } from "../src/conectores/toletus/conector";
import type { GatewayConfig, RespostaValidarAcessoCloud } from "../src/types";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { PlacaLiteNet3Falsa } from "./helpers/placaLiteNet3Falsa";

/**
 * O conector Toletus contra uma LiteNet3 falsa, por UDP e WebSocket de
 * verdade, e o GatewayService de verdade com a nuvem falsa. É a corrente
 * do lado do Gateway: anúncio → a placa disca → leitura → decisão →
 * liberação → passagem ou tempo esgotado.
 *
 * O que fica para a bancada: o valor exato da mensagem temporária no
 * display, o formato da passagem (contador ou marca de sentido) e o que a
 * placa faz quando não tem servidor nenhum.
 */

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 7878,
  modelo_catraca: "toletus",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ate(condicao: () => boolean, limiteMs = 3000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("condição não aconteceu a tempo");
    await esperar(10);
  }
}

const LIBERADO: RespostaValidarAcessoCloud = { liberado: true, motivo: "Acesso liberado.", aluno_nome: "Ana", log_id: "log-1" };

describe("conector Toletus com a LiteNet3: a corrente do lado do Gateway", () => {
  let conector: ConectorToletus | null = null;
  let placa: PlacaLiteNet3Falsa | null = null;
  let dataDir: string | null = null;

  afterEach(async () => {
    conector?.parar();
    await placa?.fechar();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    conector = null;
    placa = null;
    dataDir = null;
  });

  async function subir(o: { serialNoConfig?: string | null; timeoutGiroMs?: number; intervaloVidaMs?: number; esperaPongMs?: number } = {}) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-litenet3-test-"));
    const alunosCache = new AlunosCache(dataDir);
    const logsQueue = new LogsQueue(dataDir);
    const cloud = new FakeCloudClient();
    const gateway = new GatewayService(CONFIG, new ReceptorDriver("toletus"), cloud, alunosCache, logsQueue);
    placa = new PlacaLiteNet3Falsa();
    const portaUdp = await placa.abrir();
    conector = new ConectorToletus(
      gateway,
      [
        {
          nome: "Entrada",
          ip: "127.0.0.1",
          porta: 7878,
          liberar: "entrada",
          placa: "litenet3",
          ...(o.serialNoConfig === undefined ? {} : o.serialNoConfig ? { serial: o.serialNoConfig } : {}),
        },
      ],
      {
        timeoutGiroMs: o.timeoutGiroMs ?? 5_000,
        litenet3: {
          host: "127.0.0.1",
          porta: 0,
          placa: { portaUdp, intervaloAnuncioMs: 60, intervaloVidaMs: o.intervaloVidaMs ?? 15_000, esperaPongMs: o.esperaPongMs ?? 10_000 },
        },
      }
    );
    await conector.iniciar();
    return { cloud, alunosCache, logsQueue, gateway };
  }

  it("anuncia o endereço por UDP, a placa disca, e o firmware vai para a telemetria", async () => {
    const { gateway } = await subir();
    await ate(() => conector!.estados()[0].conectada && conector!.estados()[0].firmware !== null);
    // Descoberta primeiro (sem serial no config), depois o endereço do servidor.
    expect(placa!.udpRecebidas[0]).toEqual({ fetch: "discovery", data: null });
    expect(placa!.uri).toBe(`ws://127.0.0.1:${conector!.portaLiteNet3()}`);
    expect(conector!.estados()[0]).toMatchObject({ nome: "Entrada", conectada: true, firmware: "V1.0.1.2", serial: "00000042" });
    gateway.equipamentos.fonteToletus(() => conector!.estados());
    expect(gateway.equipamentos.paraTelemetria().equipamentos).toEqual([
      expect.objectContaining({ nome: "Toletus Entrada", tipo: "toletus", detalhe: "conectada, firmware V1.0.1.2" }),
    ]);
  });

  it("cartão liberado: release In com boas-vindas sem nome, e a passagem confirma o giro", async () => {
    const { cloud } = await subir();
    await ate(() => placa!.conectada());
    cloud.respostaValidarAcesso = LIBERADO;
    placa!.cartao("0003954862189");
    await ate(() => placa!.liberacoes().length === 1);
    expect(cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "3954862189" }]);
    expect(cloud.opcoesRecebidas[0]).toEqual({ aguardarGiro: true });
    expect(placa!.liberacoes()[0]).toEqual({ release: "In", topRow: "Bem-vindo!", bottomRow: "" });
    placa!.passagem({ in: 1 });
    await ate(() => cloud.girosConfirmados.length === 1);
    expect(cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "confirmado" }]);
  });

  it("tempo esgotado é desistência; negado não libera e não fala de dinheiro no display", async () => {
    const { cloud } = await subir();
    await ate(() => placa!.conectada());
    cloud.respostaValidarAcesso = LIBERADO;
    placa!.cartao("555");
    await ate(() => placa!.liberacoes().length === 1);
    placa!.tempoEsgotado();
    await ate(() => cloud.girosConfirmados.length === 1);
    expect(cloud.girosConfirmados[0].giro).toBe("desistencia");

    cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade da academia em atraso." };
    placa!.cartao("556");
    await ate(() => placa!.acoes().some((a) => a.action === "buzzer"));
    expect(placa!.acoes().find((a) => a.action === "display")?.data).toMatchObject({ topRow: "Fale c/ recepcao" });
    expect(placa!.liberacoes()).toHaveLength(1);
  });

  it("CPF no teclado; a imagem da digital é recusada com aviso, sem ir à nuvem", async () => {
    const { cloud } = await subir();
    await ate(() => placa!.conectada());
    cloud.respostaValidarAcesso = { liberado: false, motivo: "Aluno não encontrado nesta academia." };
    placa!.teclado("01234567890");
    await ate(() => cloud.credenciaisRecebidas.length === 1);
    expect(cloud.credenciaisRecebidas[0]).toEqual({ tipo: "cpf", valor: "01234567890" });

    placa!.pedacoDeDigital();
    placa!.pedacoDeDigital();
    await ate(() => placa!.acoes().some((a) => a.action === "display" && a.data.topRow === "Use o cartao"));
    await esperar(80);
    // Um aviso só para os vários pedaços, e nada foi à nuvem.
    expect(placa!.acoes().filter((a) => a.action === "display" && a.data.topRow === "Use o cartao")).toHaveLength(1);
    expect(cloud.credenciaisRecebidas).toHaveLength(1);
  });

  it("código de barras é negado sem ir à nuvem: um código impresso com '12' entrava como o aluno 12", async () => {
    const { cloud } = await subir();
    await ate(() => placa!.conectada());
    cloud.respostaValidarAcesso = LIBERADO;
    placa!.codigoDeBarras("12");
    await ate(() => placa!.acoes().some((a) => a.action === "display" && a.data.topRow === "Acesso negado"));
    expect(cloud.credenciaisRecebidas).toEqual([]);
    expect(placa!.liberacoes()).toHaveLength(0);
  });

  it("placa que reinicia volta sozinha, e o giro aberto na queda fecha como sem confirmação", async () => {
    const { cloud } = await subir();
    await ate(() => placa!.conectada());
    cloud.respostaValidarAcesso = LIBERADO;
    placa!.cartao("555");
    await ate(() => placa!.liberacoes().length === 1);
    placa!.derrubar();
    await ate(() => cloud.girosConfirmados.length === 1);
    expect(cloud.girosConfirmados[0].giro).toBe("sem_confirmacao");
    // O anúncio volta, e a placa disca de novo.
    await ate(() => placa!.conexoes === 2 && conector!.estados()[0].conectada);
  });

  it("placa calada (sem pong): a conexão é fechada depois da espera", async () => {
    placa = null;
    await subir({ intervaloVidaMs: 40, esperaPongMs: 80 });
    await ate(() => placa!.conectada());
    placa!.derrubar();
    placa!.responderPing = false;
    await ate(() => placa!.conectada(), 3000);
    await ate(() => placa!.conexoes >= 3, 3000);
  });

  it("serial no config: placa com outro serial não entra, nem pela porta", async () => {
    await subir({ serialNoConfig: "99999999" });
    await esperar(250);
    // A placa falsa tem o serial 00000042: o anúncio não sai para ela.
    expect(placa!.uri).toBeNull();
    // E quem discar direto, com a chave certa, é recusado na porta.
    const intruso = new WebSocket(`ws://127.0.0.1:${conector!.portaLiteNet3()}`, {
      headers: { "x-api-key": "12345-abcde-67890-fghij", Serial: "00000042" },
    });
    const status = await new Promise<number>((resolve) => {
      intruso.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      intruso.on("error", () => resolve(-1));
    });
    expect(status).toBe(403);
  });

  it("chave diferente da do firmware é recusada", async () => {
    await subir();
    await ate(() => placa!.conectada());
    const intruso = new WebSocket(`ws://127.0.0.1:${conector!.portaLiteNet3()}`, {
      headers: { "x-api-key": "outra", Serial: "00000042" },
    });
    const status = await new Promise<number>((resolve) => {
      intruso.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      intruso.on("error", () => resolve(-1));
    });
    expect(status).toBe(403);
    expect(conector!.estados()[0].conectada).toBe(true);
  });

  it("liberação remota sai pela placa conectada", async () => {
    await subir();
    await ate(() => placa!.conectada());
    expect(conector!.liberarRemoto("ambos")).toEqual({ equipamento: "Entrada" });
    await ate(() => placa!.liberacoes().length === 1);
    expect(placa!.liberacoes()[0]).toMatchObject({ release: "Both", topRow: "Liberado" });
  });
});

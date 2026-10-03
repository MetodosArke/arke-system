import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { ConectorToletus, GestaoToletus, credencialDaLeitura } from "../src/conectores/toletus/conector";
import { COMANDO } from "../src/conectores/toletus/protocolo";
import type { OpcoesValidacao } from "../src/cloud/client";
import type { Credencial, GatewayConfig, RespostaValidarAcessoCloud } from "../src/types";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { PlacaToletusFalsa } from "./helpers/placaToletusFalsa";

/**
 * O conector contra uma placa LiteNet2 falsa, por TCP de verdade, e o
 * GatewayService de verdade com a nuvem falsa. É a corrente inteira do
 * lado do Gateway: leitura → decisão (nuvem ou cache) → ordem à placa →
 * aviso de passagem → presença ou desistência.
 *
 * O que fica para a bancada: o número que um cartão de verdade produz,
 * o tempo de liberação configurado na placa e o leitor de digital.
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

/** Nuvem que pode demorar e que numera os registros, para conferir a ordem. */
class NuvemNumerada extends FakeCloudClient {
  demoraMs: number[] = [];
  private n = 0;
  async validarCredencial(credencial: Credencial, opcoes: OpcoesValidacao = {}): Promise<RespostaValidarAcessoCloud> {
    const demora = this.demoraMs.shift() ?? 0;
    if (demora) await esperar(demora);
    const r = await super.validarCredencial(credencial, opcoes);
    return { ...r, log_id: `log-${++this.n}` };
  }
}

function criar(opcoes: { timeoutGiroMs?: number; silencioMaximoMs?: number; cloud?: FakeCloudClient } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-toletus-test-"));
  const alunosCache = new AlunosCache(dataDir);
  const logsQueue = new LogsQueue(dataDir);
  const cloud = opcoes.cloud ?? new FakeCloudClient();
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("toletus"), cloud, alunosCache, logsQueue);
  const placa = new PlacaToletusFalsa();
  const montarConector = (porta: number) =>
    new ConectorToletus(gateway, [{ nome: "Entrada", ip: "127.0.0.1", porta, liberar: "entrada" }], {
      timeoutGiroMs: opcoes.timeoutGiroMs ?? 5_000,
      placa: {
        intervaloVidaMs: 40,
        silencioMaximoMs: opcoes.silencioMaximoMs ?? 2_000,
        esperaInicialMs: 20,
        esperaMaximaMs: 50,
      },
    });
  return { dataDir, alunosCache, logsQueue, cloud, gateway, placa, montarConector };
}

describe("conector Toletus: a corrente do lado do Gateway", () => {
  let amb: ReturnType<typeof criar>;
  let conector: ConectorToletus;

  async function subir(o: Parameters<typeof criar>[0] = {}) {
    amb = criar(o);
    const porta = await amb.placa.abrir();
    conector = amb.montarConector(porta);
    conector.iniciar();
    await ate(() => conector.estados()[0].conectada && amb.placa.conectada());
  }

  afterEach(async () => {
    conector?.parar();
    await amb?.placa.fechar();
    if (amb) fs.rmSync(amb.dataDir, { recursive: true, force: true });
  });

  describe("com a placa no ar", () => {
    beforeEach(async () => {
      await subir();
    });

    it("ao conectar, pergunta firmware e serial, que vão para a telemetria", async () => {
      await ate(() => conector.estados()[0].firmware !== null);
      expect(amb.placa.comandos()).toEqual(expect.arrayContaining([COMANDO.CONSULTA_FIRMWARE, COMANDO.CONSULTA_SERIAL]));
      expect(conector.estados()[0]).toMatchObject({ nome: "Entrada", conectada: true, firmware: "V2.1.1 R0", serial: "123456" });
      amb.gateway.equipamentos.fonteToletus(() => conector.estados());
      expect(amb.gateway.equipamentos.paraTelemetria().equipamentos).toEqual([
        expect.objectContaining({ nome: "Toletus Entrada", tipo: "toletus", detalhe: "conectada, firmware V2.1.1 R0" }),
      ]);
    });

    it("cartão de aluno liberado: a placa recebe a liberação e a passagem vira giro confirmado", async () => {
      amb.cloud.respostaValidarAcesso = LIBERADO;
      amb.placa.cartao("0000003954862189");
      await ate(() => amb.placa.comandos().includes(COMANDO.LIBERA_ENTRADA));
      expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "3954862189" }]);
      expect(amb.cloud.opcoesRecebidas[0]).toEqual({ aguardarGiro: true });
      // O display é público: boas-vindas, sem o nome do aluno.
      expect(amb.placa.textoDo(COMANDO.LIBERA_ENTRADA)).toBe("Bem-vindo!");

      amb.placa.passagem(1, 50);
      await ate(() => amb.cloud.girosConfirmados.length === 1);
      expect(amb.cloud.girosConfirmados).toEqual([{ logId: "log-1", giro: "confirmado" }]);
    });

    it("tempo esgotado sem passagem é desistência, que não vira presença", async () => {
      amb.cloud.respostaValidarAcesso = LIBERADO;
      amb.placa.cartao("555");
      await ate(() => amb.placa.comandos().includes(COMANDO.LIBERA_ENTRADA));
      amb.placa.tempoEsgotado();
      await ate(() => amb.cloud.girosConfirmados.length === 1);
      expect(amb.cloud.girosConfirmados[0].giro).toBe("desistencia");
    });

    it("negado: nenhuma liberação, só mensagem e aviso de erro, sem falar de dinheiro no display", async () => {
      amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade da academia em atraso." };
      amb.placa.cartao("555");
      await ate(() => amb.placa.comandos().includes(COMANDO.NOTIFICA_USUARIO));
      expect(amb.placa.textoDo(COMANDO.MENSAGEM_TEMPORARIA)).toBe("Fale c/ recepcao");
      const notificacao = amb.placa.recebidos.find((p) => p.comando === COMANDO.NOTIFICA_USUARIO)!;
      expect([...notificacao.dados.subarray(0, 5)]).toEqual([0xb8, 0x0b, 2, 1, 1]);
      expect(amb.placa.comandos()).not.toEqual(
        expect.arrayContaining([COMANDO.LIBERA_ENTRADA])
      );
      expect(amb.placa.comandos().filter((c) => c === COMANDO.LIBERA_SAIDA || c === COMANDO.LIBERA_DOIS_SENTIDOS)).toEqual([]);
    });

    it("teclado só aceita CPF; número curto é negado sem ir à nuvem; biometria é o número do usuário no leitor", async () => {
      amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Aluno não encontrado nesta academia." };
      amb.placa.teclado("01234567890");
      await ate(() => amb.cloud.credenciaisRecebidas.length === 1);
      // "12" é o número de algum aluno: digitado, entraria como ele.
      amb.placa.teclado("12");
      await ate(() => amb.placa.textoDo(COMANDO.MENSAGEM_TEMPORARIA) === "Digite o CPF");
      amb.placa.biometria(42);
      await ate(() => amb.cloud.credenciaisRecebidas.length === 2);
      expect(amb.cloud.credenciaisRecebidas).toEqual([
        { tipo: "cpf", valor: "01234567890" },
        { tipo: "identificador_catraca", valor: "42" },
      ]);
      await ate(() => amb.placa.textoDo(COMANDO.MENSAGEM_TEMPORARIA) === "Nao cadastrado");
    });

    it("passagem sem liberação nossa (saída livre) não fecha nada nem vira presença", async () => {
      amb.placa.passagem(2, 9);
      await esperar(100);
      expect(amb.cloud.girosConfirmados).toEqual([]);
      expect(amb.cloud.credenciaisRecebidas).toEqual([]);
    });

    it("liberação remota abre nos dois sentidos com aviso no display, e não abre giro de aluno", async () => {
      expect(conector.liberarRemoto("ambos")).toEqual({ equipamento: "Entrada" });
      await ate(() => amb.placa.comandos().includes(COMANDO.LIBERA_DOIS_SENTIDOS));
      expect(amb.placa.textoDo(COMANDO.LIBERA_DOIS_SENTIDOS)).toBe("Liberado");
      amb.placa.passagem(1);
      await esperar(100);
      expect(amb.cloud.girosConfirmados).toEqual([]);
      expect(() => conector.liberarRemoto("entrada", "Fundos")).toThrow(/não está configurado/);
    });

    it("gestão remota da Toletus sem leitor de digital: só liberar; cadastro recusado com explicação", async () => {
      const gestao = new GestaoToletus(conector);
      expect(gestao.capacidades()).toEqual(["liberar_catraca"]);
      expect(gestao.nomesDeCadastro()).toEqual([]);
      expect(await gestao.testar()).toEqual([{ equipamento: "Entrada", ok: true }]);
      await expect(gestao.criarUsuario(5)).rejects.toThrow(/leitor_digital/);
      await expect(gestao.cadastrarDigital(5)).rejects.toThrow(/leitor_digital/);
      await expect(gestao.cadastrarCartao()).rejects.toThrow(/Últimos acessos/);
    });
  });

  it("nova leitura com giro aberto fecha o anterior como sem confirmação, e as decisões saem na ordem", async () => {
    const cloud = new NuvemNumerada();
    cloud.respostaValidarAcesso = LIBERADO;
    // A primeira decisão demora: sem a fila por placa, a segunda liberaria antes.
    cloud.demoraMs = [150, 0];
    await subir({ cloud });
    amb.placa.cartao("111");
    amb.placa.cartao("222");
    await ate(() => amb.placa.comandos().filter((c) => c === COMANDO.LIBERA_ENTRADA).length === 2);
    expect(cloud.credenciaisRecebidas.map((c) => c.valor)).toEqual(["111", "222"]);
    amb.placa.passagem(1);
    await ate(() => cloud.girosConfirmados.length === 2);
    expect(cloud.girosConfirmados).toEqual([
      { logId: "log-1", giro: "sem_confirmacao" },
      { logId: "log-2", giro: "confirmado" },
    ]);
  });

  it("aviso que nunca chega: o prazo fecha como sem confirmação, que conta presença", async () => {
    await subir({ timeoutGiroMs: 120 });
    amb.cloud.respostaValidarAcesso = LIBERADO;
    amb.placa.cartao("555");
    await ate(() => amb.cloud.girosConfirmados.length === 1);
    expect(amb.cloud.girosConfirmados[0]).toEqual({ logId: "log-1", giro: "sem_confirmacao" });
  });

  it("queda de internet: o cache decide, o acesso fica na fila local e a passagem fecha o giro lá", async () => {
    await subir();
    amb.cloud.erroValidarAcesso = new Error("timeout");
    await amb.alunosCache.substituirTodos([
      { aluno_id: "a-1", cpf: "52998224725", nome: "Ana", inadimplente: false, identificador_catraca: "77" },
      { aluno_id: "a-2", cpf: "11144477735", nome: "Bia", inadimplente: true, identificador_catraca: "88" },
    ]);
    amb.placa.cartao("77");
    await ate(() => amb.placa.comandos().includes(COMANDO.LIBERA_ENTRADA));
    amb.placa.passagem(1);
    await ate(() => amb.placa.recebidos.length > 0);
    await esperar(100);
    amb.placa.cartao("88");
    await ate(() => amb.placa.comandos().includes(COMANDO.NOTIFICA_USUARIO));
    await esperar(100);
    const pendentes = await amb.logsQueue.listarPendentes();
    expect(pendentes.map((p) => [p.aluno_id, p.resultado, p.giro, p.cpf_consultado])).toEqual(
      expect.arrayContaining([
        ["a-1", "liberado", "confirmado", "id:77"],
        ["a-2", "negado_inadimplente", undefined, "id:88"],
      ])
    );
  });

  it("placa derrubada: reconecta sozinha, e o giro aberto na queda fecha como sem confirmação", async () => {
    await subir();
    amb.cloud.respostaValidarAcesso = LIBERADO;
    amb.placa.cartao("555");
    await ate(() => amb.placa.comandos().includes(COMANDO.LIBERA_ENTRADA));
    amb.placa.derrubar();
    await ate(() => amb.cloud.girosConfirmados.length === 1);
    expect(amb.cloud.girosConfirmados[0].giro).toBe("sem_confirmacao");
    await ate(() => amb.placa.conexoes === 2 && conector.estados()[0].conectada);
  });

  it("placa calada com a conexão aberta: depois do silêncio máximo, a conexão é reaberta", async () => {
    await subir({ silencioMaximoMs: 200 });
    amb.placa.responderConsultas = false;
    await ate(() => amb.placa.conexoes >= 2, 3000);
  });

  it("liberação que não chega à placa é fechada como não girou, não como presença", async () => {
    const cloud = new NuvemNumerada();
    cloud.respostaValidarAcesso = LIBERADO;
    cloud.demoraMs = [200];
    await subir({ cloud });
    // A placa cai enquanto a nuvem decide (200 ms): a ordem de liberar não
    // tem para onde ir.
    amb.placa.cartao("555");
    await esperar(60);
    expect(cloud.credenciaisRecebidas).toEqual([]);
    conector.parar();
    await ate(() => cloud.girosConfirmados.length === 1);
    expect(cloud.girosConfirmados[0]).toEqual({ logId: "log-1", giro: "desistencia" });
  });
});

describe("conector Toletus: credencial de cada leitura", () => {
  it("onze dígitos no teclado são CPF; qualquer outra coisa é identificador do equipamento", () => {
    expect(credencialDaLeitura("teclado", "529.982.247-25")).toEqual({ tipo: "cpf", valor: "52998224725" });
    expect(credencialDaLeitura("teclado", "1234")).toBeNull();
    // Cartão com onze dígitos continua sendo cartão: só o teclado é CPF.
    expect(credencialDaLeitura("rfid", "52998224725")).toEqual({ tipo: "identificador_catraca", valor: "52998224725" });
  });
});

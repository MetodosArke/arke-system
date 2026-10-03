import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { ConectorToletus, GestaoToletus } from "../src/conectores/toletus/conector";
import { COMANDO } from "../src/conectores/toletus/protocolo";
import {
  COMANDO_SM25,
  MontadorSM25,
  TAMANHO_REGISTRO,
  montarComando,
  montarDadosDoComando,
  dadosDeGravacao,
  registroValido,
  soma,
  valorDe,
} from "../src/conectores/toletus/sm25/protocolo";
import type { GatewayConfig, RespostaValidarAcessoCloud } from "../src/types";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { PlacaToletusFalsa } from "./helpers/placaToletusFalsa";
import { LeitorSM25Falso } from "./helpers/leitorSM25Falso";

/**
 * O cadastro da digital no leitor SM25 das catracas Toletus.
 *
 * Os bytes são conferidos contra os exemplos do manual da CAMA (o fabricante
 * do leitor), que a Toletus publica; a gestão, contra placas e leitores de
 * mentira, por TCP de verdade. O que fica para a bancada: se a placa deixa
 * o leitor livre para o cadastro enquanto alguém está conectado na 7879, o
 * tempo real de cada toque e a capacidade exata do leitor.
 */

const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ""), "hex");
/** Pacote de 24 bytes do manual: os 8 primeiros, zeros e a soma. */
function doManual(inicio: string, somaLE: string): Buffer {
  const b = Buffer.alloc(24);
  hex(inicio).copy(b);
  hex(somaLE).copy(b, 22);
  return b;
}

describe("protocolo do leitor SM25: os exemplos do manual da CAMA", () => {
  it("comandos com número saem byte a byte como no manual (§5.3.3, §5.3.5, §5.3.8)", () => {
    expect(montarComando(COMANDO_SM25.CADASTRAR, 1)).toEqual(doManual("55 AA 03 01 02 00 01 00", "06 01"));
    expect(montarComando(COMANDO_SM25.APAGAR, 1)).toEqual(doManual("55 AA 05 01 02 00 01 00", "08 01"));
    expect(montarComando(COMANDO_SM25.SITUACAO_DO_NUMERO, 1)).toEqual(doManual("55 AA 08 01 02 00 01 00", "0B 01"));
    expect(montarComando(COMANDO_SM25.LER_REGISTRO, 1)).toEqual(doManual("55 AA 0A 01 02 00 01 00", "0D 01"));
  });

  it("comandos sem parâmetro e o anúncio da gravação (§5.3.11, §5.3.15, §5.3.35, §5.3.36)", () => {
    expect(montarComando(COMANDO_SM25.CANCELAR)).toEqual(doManual("55 AA 30 01 00 00", "30 01"));
    expect(montarComando(COMANDO_SM25.TESTAR_CONEXAO)).toEqual(doManual("55 AA 50 01 00 00", "50 01"));
    expect(montarComando(COMANDO_SM25.TEMPO_DO_DEDO)).toEqual(doManual("55 AA 0F 01 00 00", "0F 01"));
    expect(montarComando(COMANDO_SM25.GRAVAR_REGISTRO, TAMANHO_REGISTRO)).toEqual(doManual("55 AA 0B 01 02 00 F2 01", "00 02"));
  });

  it("lê a sequência de respostas do cadastro do manual, com passos, número e soma", () => {
    const m = new MontadorSM25();
    const respostas = [
      doManual("AA 55 03 01 04 00 00 00 F1 FF", "F7 02"),
      doManual("AA 55 03 01 04 00 00 00 F4 FF", "FA 02"),
      doManual("AA 55 03 01 04 00 00 00 F2 FF", "F8 02"),
      doManual("AA 55 03 01 06 00 00 00 01 00", "0A 01"),
    ];
    const pacotes = m.adicionar(Buffer.concat(respostas));
    expect(pacotes.map((p) => [p.tipo, p.comando, p.ret, valorDe(p)])).toEqual([
      ["resposta", 0x0103, 0, 0xfff1],
      ["resposta", 0x0103, 0, 0xfff4],
      ["resposta", 0x0103, 0, 0xfff2],
      ["resposta", 0x0103, 0, 1],
    ]);
    // O cadastro cancelado pelo FP Cancel (§5.3.35, exemplo 2).
    const [cancelado] = m.adicionar(doManual("AA 55 03 01 04 00 01 00 41 00", "49 01"));
    expect([cancelado.ret, valorDe(cancelado)]).toEqual([1, 0x41]);
  });

  it("remonta pacote partido, pacotes colados, e descarta lixo e soma errada sem se desalinhar", () => {
    const m = new MontadorSM25();
    const a = doManual("AA 55 50 01 04 00 00 00", "54 01");
    expect(m.adicionar(a.subarray(0, 5))).toEqual([]);
    expect(m.adicionar(a.subarray(5)).map((p) => p.comando)).toEqual([0x0150]);
    const somaErrada = Buffer.from(a);
    somaErrada[23] ^= 0xff;
    // Termina com o primeiro byte de um pacote: o resto chega no pedaço seguinte.
    const lido = m.adicionar(Buffer.concat([hex("00 13 AA"), somaErrada, a, hex("AA")]));
    expect(lido.map((p) => p.comando)).toEqual([0x0150]);
    expect(m.adicionar(Buffer.from(a.subarray(1))).map((p) => p.comando)).toEqual([0x0150]);
  });

  it("pacote de dados: a gravação sai com número e registro, e a leitura volta inteira (§5.3.10, §5.3.11)", () => {
    const registro = LeitorSM25Falso.registroDoDedo(7);
    expect(registroValido(registro)).toBe(true);
    const gravacao = montarDadosDoComando(COMANDO_SM25.GRAVAR_REGISTRO, dadosDeGravacao(1, registro));
    // Do manual: 5A A5 0B 01 F4 01 01 00 + 498 bytes + soma.
    expect(gravacao.subarray(0, 8)).toEqual(hex("5A A5 0B 01 F4 01 01 00"));
    expect(gravacao.length).toBe(508);
    expect(gravacao.readUInt16LE(506)).toBe(soma(gravacao, 506));

    // Resposta de dados da leitura: A5 5A 0A 01 F6 01 00 00 01 00 + 498 bytes + soma = 510.
    const leitura = Buffer.alloc(510);
    hex("A5 5A 0A 01 F6 01 00 00 01 00").copy(leitura);
    registro.copy(leitura, 10);
    leitura.writeUInt16LE(soma(leitura, 508), 508);
    const [p] = new MontadorSM25().adicionar(leitura);
    expect([p.tipo, p.comando, p.ret, p.dados.length]).toEqual(["dados_resposta", 0x010a, 0, 500]);
    expect(p.dados.subarray(2)).toEqual(registro);

    const estragado = Buffer.from(registro);
    estragado[10] ^= 1;
    expect(registroValido(estragado)).toBe(false);
  });
});

// --- gestão contra placas e leitores de mentira ---

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

describe("digital da Toletus pela ficha do aluno", () => {
  let dataDir: string;
  let cloud: FakeCloudClient;
  let placas: PlacaToletusFalsa[];
  let leitores: LeitorSM25Falso[];
  let conector: ConectorToletus;
  let gestao: GestaoToletus;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-toletus-digital-"));
    cloud = new FakeCloudClient();
    cloud.respostaValidarAcesso = LIBERADO;
    const gateway = new GatewayService(CONFIG, new ReceptorDriver("toletus"), cloud, new AlunosCache(dataDir), new LogsQueue(dataDir));
    placas = [new PlacaToletusFalsa(), new PlacaToletusFalsa(), new PlacaToletusFalsa()];
    leitores = [new LeitorSM25Falso(), new LeitorSM25Falso()];
    const portasPlaca = await Promise.all(placas.map((p) => p.abrir()));
    const portasLeitor = await Promise.all(leitores.map((l) => l.abrir()));
    conector = new ConectorToletus(
      gateway,
      [
        { nome: "Entrada", ip: "127.0.0.1", porta: portasPlaca[0], liberar: "entrada", leitor_digital: true, porta_leitor: portasLeitor[0] },
        { nome: "Fundos", ip: "127.0.0.1", porta: portasPlaca[1], liberar: "entrada", leitor_digital: true, porta_leitor: portasLeitor[1] },
        // Catraca só de cartão: não aparece para o cadastro da digital.
        { nome: "Saída", ip: "127.0.0.1", porta: portasPlaca[2], liberar: "entrada" },
      ],
      { timeoutGiroMs: 5_000, placa: { intervaloVidaMs: 40, silencioMaximoMs: 2_000, esperaInicialMs: 20, esperaMaximaMs: 50 } }
    );
    conector.iniciar();
    await ate(() => conector.estados().every((e) => e.conectada));
    gestao = new GestaoToletus(conector, { prazoCadastroMs: 1_500, sessao: { respostaTimeoutMs: 500, conectarTimeoutMs: 500 } });
  });

  afterEach(async () => {
    conector.parar();
    await Promise.all([...placas.map((p) => p.fechar()), ...leitores.map((l) => l.fechar())]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("anuncia cadastro, digital e remoção, e lista para o cadastro só as catracas com leitor", async () => {
    expect(gestao.capacidades()).toEqual(["liberar_catraca", "cadastrar_usuario", "cadastrar_digital", "apagar_usuario"]);
    expect(gestao.nomes()).toEqual(["Entrada", "Fundos", "Saída"]);
    expect(gestao.nomesDeCadastro()).toEqual(["Entrada", "Fundos"]);
    const teste = await gestao.testar();
    expect(teste).toContainEqual({ equipamento: "Entrada (leitor de digital)", ok: true });
    leitores[1].atender = false;
    expect((await gestao.testar()).find((t) => t.equipamento === "Fundos (leitor de digital)")).toMatchObject({ ok: false });
  });

  it("'cadastrar o aluno' só reserva o número, e recusa número de cartão que não cabe no leitor", async () => {
    expect(await gestao.criarUsuario(12)).toMatchObject({ equipamentos: [], mensagem: expect.stringContaining("Número 12") });
    await expect(gestao.criarUsuario(3954862189)).rejects.toThrow(/número do cartão/);
    expect(leitores[0].comandos).toEqual([]);
  });

  it("cadastra com o aluno no leitor, mostra o passo a passo no display e copia para a outra catraca", async () => {
    leitores[0].dedo = 4;
    const r = await gestao.cadastrarDigital(12, "Entrada");
    expect(r).toEqual({ equipamento: "Entrada", replicado_em: ["Fundos"], falhou_em: [] });
    const registro = LeitorSM25Falso.registroDoDedo(4);
    expect(leitores[0].digitais.get(12)).toEqual(registro);
    expect(leitores[1].digitais.get(12)).toEqual(registro);
    // O tempo de fábrica (5 s) não dá para a recepção explicar: vai a 60, como a Toletus grava.
    expect(leitores[0].tempoDoDedo).toBe(60);
    await ate(() => placas[0].textoDo(COMANDO.MENSAGEM_TEMPORARIA) === "Digital salva");
    const textos = placas[0].recebidos
      .filter((p) => p.comando === COMANDO.MENSAGEM_TEMPORARIA)
      .map((p) => p.dados.subarray(0, p.dados.indexOf(0) === -1 ? 16 : p.dados.indexOf(0)).toString("ascii"));
    expect(textos).toEqual(
      expect.arrayContaining(["Cadastro digital", "Ponha o dedo 1/3", "Ponha o dedo 2/3", "Ponha o dedo 3/3", "Tire o dedo", "Digital salva"])
    );
    // A conexão com o leitor fecha no fim: a placa usa o leitor para reconhecer quem chega.
    await ate(() => leitores.every((l) => l.conexoesAbertas() === 0));
  });

  it("leitura ruim não encerra: o leitor pede de novo e o cadastro sai", async () => {
    leitores[0].leiturasRuins = 2;
    await expect(gestao.cadastrarDigital(3)).resolves.toMatchObject({ equipamento: "Entrada" });
    expect(leitores[0].digitais.has(3)).toBe(true);
    expect(placas[0].recebidos.some((p) => p.dados.subarray(0, 12).toString("ascii") === "Leitura ruim")).toBe(true);
  });

  it("recadastro troca a digital; se o novo falhar, a anterior volta para o leitor", async () => {
    leitores[0].digitais.set(12, LeitorSM25Falso.registroDoDedo(1));
    leitores[0].dedo = 2;
    await gestao.cadastrarDigital(12, "Entrada");
    expect(leitores[0].digitais.get(12)).toEqual(LeitorSM25Falso.registroDoDedo(2));

    // Agora as três leituras não batem: a digital do dedo 2 tem de continuar lá.
    leitores[0].falharAoUnir = true;
    leitores[0].dedo = 3;
    await expect(gestao.cadastrarDigital(12, "Entrada")).rejects.toThrow(/três leituras não bateram.*anterior continua valendo/);
    expect(leitores[0].digitais.get(12)).toEqual(LeitorSM25Falso.registroDoDedo(2));
  });

  it("digital repetida em outro número: recusa dizendo qual, e nada é copiado", async () => {
    leitores[0].digitais.set(9, LeitorSM25Falso.registroDoDedo(5));
    leitores[0].dedo = 5;
    await expect(gestao.cadastrarDigital(12, "Entrada")).rejects.toThrow(/já está no leitor da catraca "Entrada" com o número 9.*outro dedo/);
    expect(leitores[0].digitais.has(12)).toBe(false);
    expect(leitores[1].digitais.size).toBe(0);
  });

  it("sem o dedo no leitor, o prazo acaba, o cadastro é cancelado no leitor e a recepção sabe por quê", async () => {
    leitores[0].dedo = null;
    await expect(gestao.cadastrarDigital(12, "Entrada")).rejects.toThrow(/não pôs o dedo a tempo/);
    expect(leitores[0].comandos).toContain(COMANDO_SM25.CANCELAR);
    expect(leitores[0].digitais.has(12)).toBe(false);
    await ate(() => placas[0].textoDo(COMANDO.MENSAGEM_TEMPORARIA) === "Cadastro falhou");
  });

  it("durante o cadastro, a digital reconhecida pela placa é ignorada; o cartão continua valendo", async () => {
    leitores[0].dedo = null;
    const cadastro = gestao.cadastrarDigital(12, "Entrada").catch(() => null);
    await ate(() => leitores[0].comandos.includes(COMANDO_SM25.CADASTRAR));
    placas[0].biometria(12);
    placas[0].cartao("777");
    await ate(() => cloud.credenciaisRecebidas.length === 1);
    await esperar(100);
    expect(cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "777" }]);
    // Em outra catraca, a digital segue normal.
    placas[1].biometria(30);
    await ate(() => cloud.credenciaisRecebidas.length === 2);
    leitores[0].dedo = 1;
    await cadastro;
    placas[0].biometria(12);
    await ate(() => cloud.credenciaisRecebidas.length === 3);
    expect(cloud.credenciaisRecebidas[2]).toEqual({ tipo: "identificador_catraca", valor: "12" });
  });

  it("cópia que falha não desfaz o cadastro: volta em falhou_em com o motivo", async () => {
    leitores[1].atender = false;
    const r = await gestao.cadastrarDigital(12, "Entrada");
    expect(r.replicado_em).toEqual([]);
    expect(r.falhou_em).toEqual([{ equipamento: "Fundos", erro: expect.stringMatching(/leitor de digital/) }]);
    expect(leitores[0].digitais.has(12)).toBe(true);
  });

  it("número do cartão não chega ao leitor; catraca sem leitor é recusada pelo nome", async () => {
    await expect(gestao.cadastrarDigital(3954862189)).rejects.toThrow(/cartão/);
    await expect(gestao.cadastrarDigital(12, "Saída")).rejects.toThrow(/não tem leitor de digital/);
    expect(leitores[0].comandos).toEqual([]);
  });

  it("apagar tira a digital de todos os leitores; número vazio conta como apagado; leitor fora do ar falha a ordem", async () => {
    leitores[0].digitais.set(12, LeitorSM25Falso.registroDoDedo(1));
    leitores[1].digitais.set(12, LeitorSM25Falso.registroDoDedo(1));
    expect(await gestao.apagarUsuario(12)).toEqual({ equipamentos: ["Entrada", "Fundos"], apagados: 2 });
    expect(leitores.every((l) => !l.digitais.has(12))).toBe(true);
    // De novo: já não há o que apagar, e isso é sucesso.
    expect(await gestao.apagarUsuario(12)).toEqual({ equipamentos: ["Entrada", "Fundos"], apagados: 0 });
    // Número de cartão: nunca esteve no leitor.
    const antes = leitores[0].comandos.length;
    expect(await gestao.apagarUsuario(3954862189)).toEqual({ equipamentos: ["Entrada", "Fundos"], apagados: 0 });
    expect(leitores[0].comandos.length).toBe(antes);

    leitores[1].atender = false;
    leitores[0].digitais.set(7, LeitorSM25Falso.registroDoDedo(1));
    await expect(gestao.apagarUsuario(7)).rejects.toThrow(/Fundos/);
    expect(leitores[0].digitais.has(7)).toBe(false);
  });
});

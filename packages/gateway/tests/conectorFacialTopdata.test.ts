import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { ConectorFacialTopdata, GestaoTopdataFacial, type FuncaoFacial } from "../src/conectores/topdataFacial/conector";
import type { EquipamentoFacialTopdata, GatewayConfig, RespostaValidarAcessoCloud } from "../src/types";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { LeitorFacialFalso } from "./helpers/leitorFacialFalso";

/**
 * O conector dos leitores faciais da Topdata contra um leitor falso, por
 * WebSocket de verdade, e o GatewayService de verdade com a nuvem falsa.
 *
 * O que fica para a bancada: o tempo que o leitor espera a resposta
 * (`server_verify_timeout`), o que ele faz com o histórico depois de
 * reconectar e a ligação Wiegand da Fit 4 Facial com a placa Inner.
 */

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 7792,
  modelo_catraca: "topdata_facial",
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

describe("leitores faciais Topdata: a corrente do lado do Gateway", () => {
  let conector: ConectorFacialTopdata | null = null;
  const leitores: LeitorFacialFalso[] = [];
  let dataDir: string | null = null;

  afterEach(async () => {
    conector?.parar();
    for (const l of leitores.splice(0)) await l.fechar();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    conector = null;
    dataDir = null;
  });

  async function subir(o: { funcao?: FuncaoFacial; equipamentos?: EquipamentoFacialTopdata[]; timeoutOrdemMs?: number } = {}) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-facial-test-"));
    const alunosCache = new AlunosCache(dataDir);
    const logsQueue = new LogsQueue(dataDir);
    const cloud = new FakeCloudClient();
    const gateway = new GatewayService(CONFIG, new ReceptorDriver("topdata_facial"), cloud, alunosCache, logsQueue);
    const equipamentos = o.equipamentos ?? [{ nome: "Entrada", ip: "127.0.0.1", sn: "AYSH01090913" }];
    conector = new ConectorFacialTopdata(gateway, equipamentos, {
      funcao: o.funcao ?? "decide",
      host: "127.0.0.1",
      porta: 0,
      leitor: { timeoutOrdemMs: o.timeoutOrdemMs ?? 2_000 },
    });
    await conector.iniciar();
    return { cloud, alunosCache, logsQueue, gateway };
  }

  async function ligarLeitor(sn?: string): Promise<LeitorFacialFalso> {
    const leitor = new LeitorFacialFalso(sn);
    leitores.push(leitor);
    await leitor.discar(conector!.porta());
    return leitor;
  }

  it("reg aceito, e o leitor que decide fica só online e nega desconhecido", async () => {
    const { gateway } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true && leitor.ordensDe("setdevinfo").length === 1);
    expect(leitor.ordensDe("setdevinfo")[0]).toEqual({ cmd: "setdevinfo", server_verify: 1, stranger_lock: 0 });
    expect(conector!.estados()[0]).toMatchObject({ nome: "Entrada", conectado: true, modelo: "AiFace", firmware: "ai518_fp26v_v1.27" });
    gateway.equipamentos.fonteFacial(() => conector!.estados());
    expect(gateway.equipamentos.paraTelemetria().equipamentos).toEqual([
      expect.objectContaining({ nome: "Topdata facial Entrada", tipo: "topdata_facial", detalhe: "conectado, AiFace, firmware ai518_fp26v_v1.27" }),
    ]);
  });

  it("rosto de aluno liberado: access true com boas-vindas sem nome; a presença conta pela liberação", async () => {
    const { cloud } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    cloud.respostaValidarAcesso = LIBERADO;
    leitor.rosto(300);
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    expect(cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "300" }]);
    // Sem giro para esperar: a linha Easy não confirma a passagem.
    expect(cloud.opcoesRecebidas[0]).toEqual({});
    expect(leitor.respostasDe("sendlog")[0]).toMatchObject({ result: true, access: true, message: "Bem-vindo!" });
  });

  it("negado: access false, sem falar de dinheiro na tela", async () => {
    const { cloud } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade da academia em atraso." };
    leitor.rosto(301);
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    expect(leitor.respostasDe("sendlog")[0]).toMatchObject({ access: false, message: "Fale c/ recepcao" });
  });

  it("rosto desconhecido: nega sem ir à nuvem, e a foto não aparece em lugar nenhum", async () => {
    const { cloud } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    leitor.desconhecido();
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    expect(leitor.respostasDe("sendlog")[0]).toMatchObject({ access: false, message: "Nao cadastrado" });
    expect(cloud.credenciaisRecebidas).toEqual([]);
  });

  it("histórico depois de reconectar: recebido com access false, sem decidir nada", async () => {
    const { cloud } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    cloud.respostaValidarAcesso = LIBERADO;
    leitor.historico();
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    expect(leitor.respostasDe("sendlog")[0]).toMatchObject({ result: true, access: false });
    expect(cloud.credenciaisRecebidas).toEqual([]);
  });

  it("queda de internet: o cache decide, e o acesso fica na fila local", async () => {
    const { cloud, alunosCache, logsQueue } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    cloud.erroValidarAcesso = new Error("timeout");
    await alunosCache.substituirTodos([
      { aluno_id: "a-1", cpf: "52998224725", nome: "Ana", inadimplente: false, identificador_catraca: "77" },
      { aluno_id: "a-2", cpf: "11144477735", nome: "Bia", inadimplente: true, identificador_catraca: "88" },
    ]);
    leitor.rosto(77);
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    leitor.rosto(88);
    await ate(() => leitor.respostasDe("sendlog").length === 2);
    expect(leitor.respostasDe("sendlog").map((r) => r.access)).toEqual([true, false]);
    const pendentes = await logsQueue.listarPendentes();
    expect(pendentes.map((p) => [p.aluno_id, p.resultado, p.cpf_consultado])).toEqual(
      expect.arrayContaining([
        ["a-1", "liberado", "id:77"],
        ["a-2", "negado_inadimplente", "id:88"],
      ])
    );
  });

  it("leitor que só identifica (Fit 4 Facial): modo offline, e o acesso não é decidido aqui", async () => {
    const { cloud } = await subir({ funcao: "identifica" });
    const leitor = await ligarLeitor();
    await ate(() => leitor.ordensDe("setdevinfo").length === 1);
    expect(leitor.ordensDe("setdevinfo")[0]).toMatchObject({ server_verify: 0 });
    leitor.rosto(300);
    await ate(() => leitor.respostasDe("sendlog").length === 1);
    expect(leitor.respostasDe("sendlog")[0]).not.toHaveProperty("access");
    expect(cloud.credenciaisRecebidas).toEqual([]);
  });

  it("leitor fora do config.json é recusado no reg", async () => {
    await subir();
    const intruso = await ligarLeitor("OUTRO123");
    await ate(() => intruso.regAceito === false);
    await ate(() => !intruso.conectado());
    expect(conector!.estados()[0].conectado).toBe(false);
  });

  it("sem sn no config, o leitor é reconhecido pelo IP", async () => {
    await subir({ equipamentos: [{ nome: "Entrada", ip: "127.0.0.1" }] });
    const leitor = await ligarLeitor("QUALQUER1");
    await ate(() => leitor.regAceito === true);
    expect(conector!.estados()[0]).toMatchObject({ conectado: true, sn: "QUALQUER1" });
  });

  it("cadastro no menu do leitor é respondido e não vira aluno", async () => {
    const { cloud } = await subir();
    const leitor = await ligarLeitor();
    await ate(() => leitor.regAceito === true);
    leitor.cadastroNoMenu(9);
    await ate(() => leitor.respostasDe("senduser").length === 1);
    expect(leitor.respostasDe("senduser")[0]).toMatchObject({ result: true });
    expect(cloud.credenciaisRecebidas).toEqual([]);
  });

  describe("gestão remota", () => {
    it("cadastra e apaga o aluno em todos os leitores; apagar de novo continua dando certo", async () => {
      await subir({
        equipamentos: [
          { nome: "Entrada", ip: "127.0.0.1", sn: "SN-A" },
          { nome: "Saída", ip: "127.0.0.1", sn: "SN-B" },
        ],
      });
      const a = await ligarLeitor("SN-A");
      const b = await ligarLeitor("SN-B");
      await ate(() => a.regAceito === true && b.regAceito === true);
      const gestao = new GestaoTopdataFacial(conector!);
      expect(gestao.capacidades()).toEqual(["cadastrar_usuario", "apagar_usuario", "enviar_foto_rosto"]);

      expect(await gestao.criarUsuario(42)).toEqual({ equipamentos: ["Entrada", "Saída"] });
      expect(a.usuarios.get(42)).toMatchObject({ name: "Aluno", enable: 1 });
      expect(b.usuarios.get(42)).not.toHaveProperty("card");

      expect(await gestao.apagarUsuario(42)).toEqual({ equipamentos: ["Entrada", "Saída"], apagados: 2 });
      expect(a.usuarios.has(42) || b.usuarios.has(42)).toBe(false);
      expect(await gestao.apagarUsuario(42)).toEqual({ equipamentos: ["Entrada", "Saída"], apagados: 0 });
    });

    it("Fit 4 Facial: o cartão vai com o número do aluno, que é o que a placa Inner lê", async () => {
      await subir({ funcao: "identifica" });
      const leitor = await ligarLeitor();
      await ate(() => leitor.regAceito === true);
      await new GestaoTopdataFacial(conector!).criarUsuario(42);
      expect(leitor.usuarios.get(42)).toMatchObject({ card: 42 });
    });

    it("leitor fora do ar: a remoção falha dizendo qual, para a ordem continuar pendente", async () => {
      await subir({
        equipamentos: [
          { nome: "Entrada", ip: "127.0.0.1", sn: "SN-A" },
          { nome: "Saída", ip: "127.0.0.1", sn: "SN-B" },
        ],
      });
      const a = await ligarLeitor("SN-A");
      await ate(() => a.regAceito === true);
      const gestao = new GestaoTopdataFacial(conector!);
      await expect(gestao.apagarUsuario(42)).rejects.toThrow(/Remoção incompleta.*Saída: .*não está conectado/);
    });

    it("leitor que não responde: a ordem falha no prazo, sem travar as seguintes", async () => {
      await subir({ timeoutOrdemMs: 150 });
      const leitor = await ligarLeitor();
      await ate(() => leitor.regAceito === true && leitor.ordensDe("setdevinfo").length === 1);
      leitor.responderOrdens = false;
      const gestao = new GestaoTopdataFacial(conector!);
      await expect(gestao.criarUsuario(1)).rejects.toThrow(/não respondeu a "setuserinfo"/);
      leitor.responderOrdens = true;
      expect(await gestao.criarUsuario(2)).toEqual({ equipamentos: ["Entrada"] });
    });

    it("foto do app: vai a todos os leitores com backupnum 50, e não volta no resultado", async () => {
      await subir({
        equipamentos: [
          { nome: "Entrada", ip: "127.0.0.1", sn: "SN-A" },
          { nome: "Saída", ip: "127.0.0.1", sn: "SN-B" },
        ],
      });
      const a = await ligarLeitor("SN-A");
      const b = await ligarLeitor("SN-B");
      await ate(() => a.regAceito === true && b.regAceito === true);
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("FOTO-DO-APP"), Buffer.alloc(1500, 7)]);
      const r = await new GestaoTopdataFacial(conector!).enviarFotoRosto(42, jpeg);
      expect(r).toEqual({ equipamentos: ["Entrada", "Saída"] });
      for (const l of [a, b]) {
        const u = l.usuarios.get(42)!;
        expect(u).toMatchObject({ backupnum: 50, name: "Aluno", enable: 1 });
        expect(Buffer.from(String(u.record).replace("data:image/jpeg;base64,", ""), "base64").toString()).toContain("FOTO-DO-APP");
      }
      expect(JSON.stringify(r)).not.toContain("base64");
    });

    it("foto recusada pelo leitor: a ordem falha com o motivo em português", async () => {
      await subir();
      const leitor = await ligarLeitor();
      await ate(() => leitor.regAceito === true);
      leitor.recusarFoto = { reason: 6, msg: "multi faces" };
      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(1500, 7)]);
      await expect(new GestaoTopdataFacial(conector!).enviarFotoRosto(42, jpeg)).rejects.toThrow(/Entrada: mais de um rosto na imagem/);
    });

    it("câmera do leitor (API HTTP): cadastra no leitor com senha e copia a foto ao outro", async () => {
      const a = new LeitorFacialFalso("SN-A");
      leitores.push(a);
      const portaHttp = await a.abrirApiHttp();
      await subir({
        funcao: "identifica",
        equipamentos: [
          { nome: "Entrada", ip: "127.0.0.1", sn: "SN-A", senha: "1234", porta_http: portaHttp },
          { nome: "Saída", ip: "127.0.0.1", sn: "SN-B" },
        ],
      });
      await a.discar(conector!.porta());
      const b = await ligarLeitor("SN-B");
      await ate(() => a.regAceito === true && b.regAceito === true);
      const gestao = new GestaoTopdataFacial(conector!, { timeoutCadastroMs: 2_000, intervaloConsultaMs: 20 });
      expect(gestao.capacidades()).toEqual(expect.arrayContaining(["cadastrar_rosto", "enviar_foto_rosto", "liberar_catraca"]));
      expect(gestao.temRosto("Entrada")).toBe(true);
      expect(gestao.temRosto("Saída")).toBe(false);

      const r = await gestao.cadastrarRosto(42);
      expect(r).toEqual({ equipamento: "Entrada", replicado_em: ["Saída"], falhou_em: [] });
      expect(a.chamadasHttp.find((c) => c.cmd === "adduser")).toMatchObject({ enrollid: 42, backupnum: 50, password: "1234" });
      const copia = b.usuarios.get(42)!;
      expect(copia).toMatchObject({ backupnum: 50, card: 42 });
      expect(Buffer.from(String(copia.record).replace("data:image/jpeg;base64,", ""), "base64").toString()).toContain("ROSTO-DA-CAMERA-TOPDATA");
      expect(JSON.stringify(r)).not.toContain("ROSTO");
    });

    it("câmera cancelada no leitor: erro, e o leitor sai da tela de cadastro", async () => {
      const a = new LeitorFacialFalso("SN-A");
      leitores.push(a);
      const portaHttp = await a.abrirApiHttp();
      await subir({ equipamentos: [{ nome: "Entrada", ip: "127.0.0.1", sn: "SN-A", senha: "1234", porta_http: portaHttp }] });
      await a.discar(conector!.porta());
      await ate(() => a.regAceito === true);
      a.cadastroCamera = "cancela";
      const gestao = new GestaoTopdataFacial(conector!, { timeoutCadastroMs: 2_000, intervaloConsultaMs: 20 });
      await expect(gestao.cadastrarRosto(42)).rejects.toThrow(/cancelado no leitor/);
      a.cadastroCamera = "nunca";
      const lenta = new GestaoTopdataFacial(conector!, { timeoutCadastroMs: 100, intervaloConsultaMs: 20 });
      await expect(lenta.cadastrarRosto(43)).rejects.toThrow(/não terminou o cadastro do rosto/);
      expect(a.chamadasHttp.filter((c) => c.cmd === "adduser" && c.cancel === true).length).toBeGreaterThanOrEqual(2);
    });

    it("leitor sem a senha do menu não abre a câmera", async () => {
      await subir();
      const leitor = await ligarLeitor();
      await ate(() => leitor.regAceito === true);
      const gestao = new GestaoTopdataFacial(conector!);
      expect(gestao.capacidades()).not.toContain("cadastrar_rosto");
      await expect(gestao.cadastrarRosto(42)).rejects.toThrow(/sem a senha do menu/);
    });

    it("abertura remota pela API HTTP do leitor, com a senha do menu", async () => {
      const api = new LeitorFacialFalso();
      leitores.push(api);
      const portaHttp = await api.abrirApiHttp();
      await subir({ equipamentos: [{ nome: "Entrada", ip: "127.0.0.1", sn: "AYSH01090913", senha: "1234", porta_http: portaHttp }] });
      const leitor = await ligarLeitor();
      await ate(() => leitor.regAceito === true);
      // Ao conectar, as fotos de acesso e de desconhecido são desligadas.
      await ate(() => api.chamadasHttp.some((c) => c.cmd === "setdevinfo"));
      expect(api.chamadasHttp.find((c) => c.cmd === "setdevinfo")).toMatchObject({ use_logphoto: 0, stranger_photo: 0, password: "1234" });

      const gestao = new GestaoTopdataFacial(conector!);
      expect(gestao.capacidades()).toContain("liberar_catraca");
      expect(await gestao.liberarCatraca("entrada")).toEqual({ equipamento: "Entrada" });
      expect(api.chamadasHttp.find((c) => c.cmd === "opendoor")).toMatchObject({ msg: "Liberado", password: "1234" });

      api.senhaHttp = "outra";
      await expect(gestao.liberarCatraca("entrada")).rejects.toThrow(/senha do leitor incorreta/);
    });
  });
});

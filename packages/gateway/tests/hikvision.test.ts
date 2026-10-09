import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { GatewayService } from "../src/core/gatewayService";
import { AlunosCache } from "../src/offline/alunosCache";
import { LogsQueue } from "../src/offline/logsQueue";
import { ReceptorDriver } from "../src/drivers/ReceptorDriver";
import { criarServidorReceptor } from "../src/server/localServer";
import { ipsPermitidos } from "../src/server/origemEquipamento";
import { autorizacaoDigest, lerDesafio } from "../src/core/digest";
import {
  acessoDoEvento,
  classificarAcesso,
  configuracaoDeAcesso,
  ehControladora,
  ehPedidoDeAgora,
  eventosDoCorpo,
  lerCapacidades,
  lerInfoDoAparelho,
  lerStatus,
  mensagemDoErro,
  numeroDoAcesso,
  respostaDaDecisao,
  usuarioDoAluno,
  xmlServidorDeEventos,
} from "../src/conectores/hikvision/protocolo";
import { ConectorHikvision, GestaoHikvision } from "../src/conectores/hikvision/conector";
import { ClienteHikvision } from "../src/conectores/hikvision/cliente";
import { FakeCloudClient } from "./helpers/fakeCloudClient";
import { AparelhoHikvisionFalso, type TipoAparelho } from "./helpers/aparelhoHikvisionFalso";
import type { AlunoCache, EquipamentoHikvision, GatewayConfig } from "../src/types";

const CONFIG: GatewayConfig = {
  organization_id: "00000000-0000-0000-0000-000000000000",
  token_api_local: "token-de-teste",
  supabase_url: "https://example.supabase.co",
  catraca_ip: "127.0.0.1",
  catraca_porta: 80,
  modelo_catraca: "hikvision",
  tempo_timeout_ms: 300,
  sincronizar_alunos_intervalo_ms: 300_000,
  escuta_host: "127.0.0.1",
  escuta_porta: 4571,
  confirmacao_giro: "decisao",
  timeout_giro_ms: 30_000,
};

const IP_TERMINAL = "10.0.0.30";
const IP_CONTROLADORA = "10.0.0.31";
const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000);

describe("Hikvision: protocolo", () => {
  it("Digest: o exemplo da RFC 7616, em MD5 e em SHA-256", () => {
    const base = 'realm="http-auth@example.org", qop="auth, auth-int", nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"';
    const assinar = (alg: string) =>
      autorizacaoDigest({
        usuario: "Mufasa",
        senha: "Circle of Life",
        metodo: "GET",
        uri: "/dir/index.html",
        desafio: lerDesafio(`Digest ${base}, algorithm=${alg}`)!,
        nc: 1,
        cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
      });
    expect(assinar("MD5")).toContain('response="8ca523f5e9506fed4657c9700eebdbec"');
    expect(assinar("SHA-256")).toContain('response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"');
    // "nonce" não se confunde com outro campo, e o aviso de nonce vencido é lido.
    expect(lerDesafio('Digest qop="auth", realm="IP Camera(C2183)", nonce="4e54", stale="TRUE"')).toMatchObject({ realm: "IP Camera(C2183)", nonce: "4e54", stale: true });
  });

  it("o aluno no aparelho: nome 'Aluno', o número da catraca, e o barrado fora da validade", () => {
    const u = usuarioDoAluno(42, false, 1).UserInfo as Record<string, any>;
    expect(u).toMatchObject({ employeeNo: "42", name: "Aluno", userType: "normal", doorRight: "1" });
    expect(u.Valid.endTime > "2037").toBe(true);
    const b = usuarioDoAluno(42, true).UserInfo as Record<string, any>;
    expect(b.name).toBe("Aluno");
    // Fora da validade hoje: o aparelho recusa sozinho, também sem o Gateway.
    expect(b.Valid.enable).toBe(true);
    expect(b.Valid.endTime < new Date().toISOString().slice(0, 19)).toBe(true);
    expect(usuarioDoAluno(7, false, 3).UserInfo).toMatchObject({ doorRight: "3", RightPlan: [{ doorNo: 3 }] });
  });

  it("lê o evento do multipart e deixa a foto de fora", () => {
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from('"employeeNoString":"999"-na-foto'), Buffer.from([0xff, 0xd9])]);
    const { corpo, tipo } = AparelhoHikvisionFalso.corpoEvento({ subEventType: 0x4b, employeeNoString: "42", serialNo: 7, remoteCheck: true }, foto);
    const eventos = eventosDoCorpo(corpo, tipo);
    expect(eventos).toHaveLength(1);
    expect(JSON.stringify(eventos)).not.toContain("na-foto");
    expect(acessoDoEvento(eventos[0])).toMatchObject({ employeeNo: "42", menor: 0x4b, serial: 7, pedeDecisao: true, leitor: 1 });
  });

  it("aceita o evento em XML e o corpo que já é o JSON", () => {
    const xml =
      "<EventNotificationAlert><dateTime>2026-10-08T10:00:00-03:00</dateTime><eventType>AccessControllerEvent</eventType>" +
      "<AccessControllerEvent><majorEventType>5</majorEventType><subEventType>38</subEventType><employeeNoString>8</employeeNoString>" +
      "<serialNo>3</serialNo><currentEvent>false</currentEvent></AccessControllerEvent></EventNotificationAlert>";
    const a = acessoDoEvento(eventosDoCorpo(Buffer.from(xml), "application/xml")[0])!;
    expect(a).toMatchObject({ employeeNo: "8", menor: 0x26, emTempoReal: false, pedeDecisao: false });
    expect(a.quando?.toISOString()).toBe("2026-10-08T13:00:00.000Z");
    const json = JSON.stringify({ eventType: "AccessControllerEvent", AccessControllerEvent: { subEventType: 1, cardNo: "00123" } });
    expect(numeroDoAcesso(acessoDoEvento(eventosDoCorpo(Buffer.from(json), "application/json")[0])!)).toBe("123");
    expect(eventosDoCorpo(Buffer.from("lixo"), null)).toEqual([]);
  });

  it("classifica o acesso: rosto, digital e cartão aceitos; recusas negadas; porta não é acesso", () => {
    const ev = (menor: number, maior = 5) => acessoDoEvento({ eventType: "AccessControllerEvent", AccessControllerEvent: { majorEventType: maior, subEventType: menor } })!;
    for (const aceito of [0x01, 0x26, 0x4b]) expect(classificarAcesso(ev(aceito))).toBe("aceito");
    for (const negado of [0x06, 0x08, 0x09, 0x27, 0x4c, 0x71]) expect(classificarAcesso(ev(negado))).toBe("negado");
    expect(classificarAcesso(ev(0x15))).toBe("outro");
    expect(classificarAcesso(ev(0x400, 3))).toBe("outro");
    expect(acessoDoEvento({ eventType: "heartBeat" })).toBeNull();
  });

  it("o número do acesso: o do aluno; senão o cartão, sem zeros; QR não identifica", () => {
    const a = (d: Record<string, unknown>) => acessoDoEvento({ eventType: "AccessControllerEvent", AccessControllerEvent: d })!;
    expect(numeroDoAcesso(a({ employeeNoString: "42", cardNo: "999" }))).toBe("42");
    expect(numeroDoAcesso(a({ cardNo: "000ec56d" }))).toBe("EC56D");
    expect(a({ swipeCardType: 1, cardNo: "12" }).codigo).toBe(true);
    expect(a({ cardReaderKind: 3 }).codigo).toBe(true);
    expect(a({ QRCodeInfo: "12" }).codigo).toBe(true);
    expect(a({ cardNo: "12" }).codigo).toBe(false);
  });

  it("pedido de agora versus pedido antigo que ninguém espera", () => {
    const a = (d: Record<string, unknown>, quando: Date) => acessoDoEvento({ eventType: "AccessControllerEvent", dateTime: quando.toISOString(), AccessControllerEvent: d })!;
    expect(ehPedidoDeAgora(a({ remoteCheck: true }, new Date()))).toBe(true);
    expect(ehPedidoDeAgora(a({ remoteCheck: true }, minutosAtras(15)))).toBe(false);
    expect(ehPedidoDeAgora(a({ remoteCheck: true, currentEvent: false }, new Date()))).toBe(false);
    expect(ehPedidoDeAgora(a({ remoteCheck: false }, new Date()))).toBe(false);
  });

  it("a resposta da decisão: o mesmo número do evento, sem o nome e sem falar de dinheiro", () => {
    expect(respostaDaDecisao(1866, true, "Ana Souza")).toEqual({ RemoteCheck: { serialNo: 1866, checkResult: "success", info: "Bem-vindo!" } });
    const negado = respostaDaDecisao(5, false, "Mensalidade em atraso.") as { RemoteCheck: { checkResult: string; info: string } };
    expect(negado.RemoteCheck.checkResult).toBe("failed");
    expect(negado.RemoteCheck.info).not.toMatch(/atraso|mensalidade|ana/i);
  });

  it("modelo e capacidades: o terminal e a controladora, pelo que o aparelho declara", () => {
    const info = lerInfoDoAparelho("<DeviceInfo><model>DS-K2604</model><firmwareVersion>V2.1.0</firmwareVersion></DeviceInfo>");
    expect(info).toMatchObject({ modelo: "DS-K2604", firmware: "V2.1.0" });
    expect(ehControladora(info)).toBe(true);
    expect(ehControladora(lerInfoDoAparelho("<DeviceInfo><model>DS-K1T671MF</model></DeviceInfo>"))).toBe(false);
    const caps = lerCapacidades(
      "<AccessControl><isSupportUserInfo>true</isSupportUserInfo><isSupportFDLibAsyncResults>true</isSupportFDLibAsyncResults>" +
        "<isSupportFingerPrintCfg>true</isSupportFingerPrintCfg><isSupportRemoteCheck>false</isSupportRemoteCheck></AccessControl>"
    );
    // O "assíncrono" da biblioteca de rostos não é a biblioteca de rostos.
    expect(caps).toMatchObject({ pessoa: true, rosto: false, digital: true, verificacaoRemota: false, cartao: false });
    expect(lerCapacidades('{"AccessControl":{"isSupportFDLib":true,"isSupportCardInfo":"true"}}')).toMatchObject({ rosto: true, cartao: true });
  });

  it("erro do aparelho vira frase clara, com o código para o suporte", () => {
    const s = lerStatus('{"statusCode":6,"statusString":"Invalid Content","subStatusCode":"cardNoAlreadyExist","errorCode":1610637363}')!;
    expect(mensagemDoErro(s)).toBe("este cartão já está cadastrado para outra pessoa no aparelho (cardNoAlreadyExist)");
    const x = lerStatus("<ResponseStatus><statusCode>4</statusCode><subStatusCode>notSupport</subStatusCode></ResponseStatus>")!;
    expect(mensagemDoErro(x)).toMatch(/não tem esta função/);
    expect(mensagemDoErro({ statusCode: 6, subStatusCode: "algoNovo", errorCode: null })).toBe("o aparelho recusou o conteúdo do pedido (algoNovo)");
    expect(mensagemDoErro(null, 500)).toBe("o aparelho respondeu 500");
  });

  it("configuração de acesso: pergunta ao Gateway e espera a resposta, decide sozinho sem ele, e as fotos de cada acesso desligadas", () => {
    const c = configuracaoDeAcesso({ uploadVerificationPic: true, saveFacePic: true, showName: true }, { verificacaoRemota: true, comRosto: true }).AcsCfg as Record<string, unknown>;
    expect(c).toMatchObject({
      remoteCheckDoorEnabled: true,
      checkChannelType: "ISAPIListen",
      remoteCheckWithISAPIListen: "sync",
      needDeviceCheck: true,
      offlineDevCheckOpenDoorEnabled: true,
      remoteCheckVerifyMode: 6,
      uploadVerificationPic: false,
      saveFacePic: false,
      showName: true,
    });
    // Campo de foto que o aparelho não tem não é inventado.
    expect("uploadCapPic" in c).toBe(false);
    const semRemota = configuracaoDeAcesso({}, { verificacaoRemota: false, comRosto: false }).AcsCfg as Record<string, unknown>;
    expect(semRemota.remoteCheckDoorEnabled).toBeUndefined();
    expect((configuracaoDeAcesso({}, { verificacaoRemota: true, comRosto: false }).AcsCfg as Record<string, unknown>).remoteCheckVerifyMode).toBe(4);
  });

  it("servidor de eventos: o endereço e a porta do Gateway, em JSON, sem autenticação e com reenvio", () => {
    const x = xmlServidorDeEventos("192.168.0.9", 4571);
    for (const t of ["<ipAddress>192.168.0.9</ipAddress>", "<portNo>4571</portNo>", "<url>/hikvision/evento</url>", "<parameterFormatType>JSON</parameterFormatType>", "<httpBroken>true</httpBroken>", "<httpAuthenticationMethod>none</httpAuthenticationMethod>"]) {
      expect(x).toContain(t);
    }
  });
});

function ambiente(alunos: AlunoCache[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arke-hikvision-test-"));
  const cache = new AlunosCache(dir);
  const cloud = new FakeCloudClient();
  cloud.respostaValidarAcesso = { liberado: true, aluno_nome: "Ana", log_id: "log-1" };
  const gateway = new GatewayService(CONFIG, new ReceptorDriver("hikvision"), cloud, cache, new LogsQueue(dir));
  return { dir, cache, cloud, gateway, alunos };
}

const aluno = (id: string, barrado = false): AlunoCache => ({
  aluno_id: `a-${id}`,
  cpf: `1234567890${id}`.slice(-11),
  inadimplente: barrado,
  identificador_catraca: id,
});

describe("Hikvision: receptor", () => {
  let amb: ReturnType<typeof ambiente>;
  let app: ReturnType<typeof criarServidorReceptor>["app"];
  beforeEach(() => {
    amb = ambiente();
    const permitidos = ipsPermitidos({
      hikvision_equipamentos: [
        { nome: "Catraca da entrada", ip: IP_TERMINAL, porta: 80, usuario: "admin", senha: "x", porta_acesso: 1, leitores_digital: [1] },
        { nome: "Controladora", ip: IP_CONTROLADORA, porta: 80, usuario: "admin", senha: "x", porta_acesso: 1, leitores_digital: [1] },
      ],
    });
    app = criarServidorReceptor(amb.gateway, {
      host: "127.0.0.1",
      porta: 0,
      ipsPermitidos: permitidos,
      hikvision: {
        nomePorIp: (ip) => (ip === IP_TERMINAL ? "Catraca da entrada" : ip === IP_CONTROLADORA ? "Controladora" : null),
        leitoresDeSaida: (ip) => (ip === IP_CONTROLADORA ? [2, 4] : []),
      },
    }).app;
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(amb.dir, { recursive: true, force: true });
  });

  const evento = (dados: Record<string, unknown>, ip = IP_TERMINAL, quando = new Date(), foto: Buffer | null = null) => {
    const { corpo, tipo } = AparelhoHikvisionFalso.corpoEvento(dados, foto, quando);
    return app.inject({ method: "POST", url: "/hikvision/evento", remoteAddress: ip, headers: { "content-type": tipo }, payload: corpo });
  };
  const esperar = () => new Promise((r) => setTimeout(r, 100));

  it("pedido de decisão do aluno liberado: success, com o número do evento, e à nuvem vai só o número do aluno", async () => {
    const r = await evento({ subEventType: 0x4b, employeeNoString: "42", name: "Aluno", serialNo: 1866, remoteCheck: true }, IP_TERMINAL, new Date(), AparelhoHikvisionFalso.jpeg(500));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ RemoteCheck: { serialNo: 1866, checkResult: "success", info: "Bem-vindo!" } });
    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "42" }]);
    expect(amb.cloud.opcoesRecebidas[0].aguardarGiro).toBe(false);
  });

  it("aluno barrado: failed, e o aparelho não mostra o motivo", async () => {
    amb.cloud.respostaValidarAcesso = { liberado: false, motivo: "Mensalidade em atraso." };
    const r = await evento({ subEventType: 0x4b, employeeNoString: "43", serialNo: 9, remoteCheck: true });
    expect(r.json().RemoteCheck.checkResult).toBe("failed");
    expect(r.json().RemoteCheck.info).not.toMatch(/atraso|mensalidade/i);
  });

  it("cartão sem aluno vai à nuvem pelo número lido; QR é negado sem ir à nuvem", async () => {
    await evento({ subEventType: 0x09, cardNo: "0012AB", serialNo: 1, remoteCheck: true });
    expect(amb.cloud.credenciaisRecebidas).toEqual([{ tipo: "identificador_catraca", valor: "12AB" }]);
    const qr = await evento({ subEventType: 0x9c, cardNo: "12", swipeCardType: 1, serialNo: 2, remoteCheck: true });
    expect(qr.json().RemoteCheck).toMatchObject({ checkResult: "failed", info: "Acesso negado" });
    expect(amb.cloud.credenciaisRecebidas).toHaveLength(1);
  });

  it("saída pelo leitor de saída passa sem consultar ninguém", async () => {
    const r = await evento({ subEventType: 0x01, employeeNoString: "43", cardReaderNo: 2, serialNo: 3, remoteCheck: true }, IP_CONTROLADORA);
    expect(r.json().RemoteCheck.checkResult).toBe("success");
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("nuvem fora: o cache decide, e o acesso sobe depois", async () => {
    await amb.cache.substituirTodos([aluno("42"), aluno("43", true)]);
    amb.cloud.erroValidarAcesso = new Error("timeout");
    amb.cloud.erroSincronizarLogs = new Error("sem internet");
    expect((await evento({ subEventType: 0x4b, employeeNoString: "42", serialNo: 4, remoteCheck: true })).json().RemoteCheck.checkResult).toBe("success");
    expect((await evento({ subEventType: 0x4b, employeeNoString: "43", serialNo: 5, remoteCheck: true })).json().RemoteCheck).toMatchObject({ checkResult: "failed", info: "Fale c/ recepcao" });
    amb.cloud.erroSincronizarLogs = null;
    await amb.gateway.enviarLogsPendentes();
    expect(amb.cloud.logsRecebidos.map((l) => [l.cpf_consultado, l.resultado])).toEqual([
      ["id:42", "liberado"],
      ["id:43", "negado_inadimplente"],
    ]);
  });

  it("o aviso do resultado, depois da decisão, não conta de novo", async () => {
    await evento({ subEventType: 0x4b, employeeNoString: "42", serialNo: 11, remoteCheckResult: "success" });
    await esperar();
    expect(amb.cloud.logsRecebidos).toEqual([]);
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("acesso que o aparelho decidiu sozinho vira presença na hora em que aconteceu, uma vez só mesmo reenviado", async () => {
    const quando = minutosAtras(60);
    for (let i = 0; i < 2; i++) {
      const r = await evento({ subEventType: 0x26, employeeNoString: "42", serialNo: 77, currentEvent: false }, IP_TERMINAL, quando);
      expect(r.statusCode).toBe(200);
      expect(r.body).toBe("");
    }
    await esperar();
    expect(amb.cloud.logsRecebidos.map((l) => [l.cpf_consultado, l.giro, l.ocorrido_em])).toEqual([["id:42", "confirmado", quando.toISOString()]]);
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("negado no aparelho, saída e pedido antigo de QR não viram presença", async () => {
    await evento({ subEventType: 0x08, employeeNoString: "43", serialNo: 20 }, IP_TERMINAL, minutosAtras(30));
    await evento({ subEventType: 0x01, employeeNoString: "44", cardReaderNo: 2, serialNo: 21 }, IP_CONTROLADORA, minutosAtras(30));
    await evento({ subEventType: 0x9c, cardNo: "12", swipeCardType: 1, serialNo: 22 }, IP_TERMINAL, minutosAtras(30));
    await esperar();
    expect(amb.cloud.logsRecebidos).toEqual([]);
  });

  it("evento que não é de acesso não pede nada", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/hikvision/evento",
      remoteAddress: IP_TERMINAL,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ eventType: "heartBeat", dateTime: new Date().toISOString() }),
    });
    expect(r.statusCode).toBe(200);
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
  });

  it("aparelho fora do config é recusado; o do config passa e aparece na telemetria pelo nome", async () => {
    const intruso = await evento({ subEventType: 0x4b, employeeNoString: "42", serialNo: 1, remoteCheck: true }, "10.0.0.99");
    expect(intruso.statusCode).toBe(403);
    expect(amb.cloud.credenciaisRecebidas).toEqual([]);
    const ok = await evento({ subEventType: 0x4b, employeeNoString: "42", serialNo: 2, remoteCheck: true }, `::ffff:${IP_TERMINAL}`);
    expect(ok.statusCode).toBe(200);
    expect(amb.gateway.equipamentos.paraTelemetria().equipamentos).toContainEqual(expect.objectContaining({ nome: "Catraca da entrada", tipo: "hikvision" }));
  });
});

describe("Hikvision: gestão pelo Gateway", () => {
  const aparelhos: AparelhoHikvisionFalso[] = [];
  let amb: ReturnType<typeof ambiente>;
  let conector: ConectorHikvision;
  let gestao: GestaoHikvision;

  const eq = (a: AparelhoHikvisionFalso, nome: string, extra: Partial<EquipamentoHikvision> = {}): EquipamentoHikvision => ({
    nome,
    ip: "127.0.0.1",
    porta: a.porta,
    usuario: "admin",
    senha: "Senha12345",
    porta_acesso: 1,
    leitores_digital: [1],
    ...extra,
  });
  const novoAparelho = async (tipo: TipoAparelho = "terminal", comFacial = false) => {
    const a = new AparelhoHikvisionFalso(tipo, comFacial);
    await a.iniciar();
    aparelhos.push(a);
    return a;
  };
  const montar = async (lista: EquipamentoHikvision[]) => {
    conector = new ConectorHikvision(amb.gateway, lista, { porta: 4571, endereco: "192.168.0.9", cliente: { esperaMs: 1 }, intervaloProgressoMs: 5 });
    gestao = new GestaoHikvision(conector);
    await conector.verificar();
  };

  beforeEach(() => {
    amb = ambiente();
  });
  afterEach(async () => {
    conector?.parar();
    for (const a of aparelhos.splice(0)) await a.parar();
    fs.rmSync(amb.dir, { recursive: true, force: true });
  });

  it("conhece e configura: modelo, hora, servidor de eventos e verificação remota síncrona", async () => {
    const a = await novoAparelho("terminal");
    await montar([eq(a, "Catraca da entrada")]);
    expect(conector.estados()[0]).toMatchObject({ alcancavel: true, modelo: "DS-K1T671MF", firmware: "V3.9.0", verificacaoRemota: true });
    expect(a.hora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(a.servidorDeEventos).toEqual({ ip: "192.168.0.9", porta: 4571, url: "/hikvision/evento", formato: "JSON", reenvio: true });
    expect(a.acsCfg).toMatchObject({
      remoteCheckDoorEnabled: true,
      checkChannelType: "ISAPIListen",
      remoteCheckWithISAPIListen: "sync",
      offlineDevCheckOpenDoorEnabled: true,
      uploadVerificationPic: false,
      saveFacePic: false,
      showName: true,
    });
    expect(gestao.capacidades().sort()).toEqual(
      ["apagar_usuario", "cadastrar_cartao", "cadastrar_digital", "cadastrar_rosto", "cadastrar_usuario", "enviar_foto_rosto", "liberar_catraca"].sort()
    );
  });

  it("controladora sem câmera: cartão e digital, sem rosto; com terminal facial ligado, o rosto aparece", async () => {
    const c = await novoAparelho("controladora");
    await montar([eq(c, "Controladora")]);
    expect(conector.estados()[0]).toMatchObject({ modelo: "DS-K2604", verificacaoRemota: false });
    expect(gestao.capacidades()).not.toContain("enviar_foto_rosto");
    expect(gestao.capacidades()).not.toContain("cadastrar_rosto");
    expect(conector.leitoresDeSaida("Controladora")).toEqual([2, 4, 6, 8]);
    await expect(gestao.enviarFotoRosto(1, AparelhoHikvisionFalso.jpeg(3000))).rejects.toThrow(/Nenhum aparelho Hikvision com reconhecimento facial/);

    conector.parar();
    const cf = await novoAparelho("controladora", true);
    await montar([eq(cf, "Controladora com facial", { leitores_saida: [] })]);
    expect(gestao.capacidades()).toContain("enviar_foto_rosto");
    expect(conector.leitoresDeSaida("Controladora com facial")).toEqual([]);
  });

  it("senha errada: recusa uma vez só, sem insistir, e a frase diz o que conferir", async () => {
    const a = await novoAparelho();
    await montar([eq(a, "Catraca", { senha: "outra" })]);
    expect(a.recusasDeSenha).toBe(1);
    expect(conector.estados()[0]).toMatchObject({ alcancavel: false });
    expect(conector.estados()[0].erro).toMatch(/usuário ou senha do aparelho recusados/);
    // Em pausa: a conferência seguinte não insiste na senha errada.
    await conector.verificar();
    expect(a.recusasDeSenha).toBe(1);
  });

  it("Digest: o nonce troca no meio e tudo segue", async () => {
    const a = await novoAparelho();
    await montar([eq(a, "Catraca")]);
    await gestao.criarUsuario(1);
    a.trocarNonce();
    await gestao.criarUsuario(2);
    expect([...a.usuarios.keys()]).toEqual(["1", "2"]);
    expect(a.recusasDeSenha).toBe(1);
  });

  it("novas tentativas: aparelho ocupado responde na seguinte; ocupado demais vira erro claro", async () => {
    const a = await novoAparelho();
    await montar([eq(a, "Catraca")]);
    a.ocupadoPor = 2;
    await gestao.criarUsuario(5);
    expect(a.usuarios.has("5")).toBe(true);
    a.ocupadoPor = 10;
    await expect(gestao.criarUsuario(6)).rejects.toThrow(/ocupado.*\(deviceBusy\)/);
  });

  it("prazo: aparelho que aceita a conexão e não responde vira erro claro", async () => {
    const calado = net.createServer(() => undefined);
    await new Promise<void>((r) => calado.listen(0, "127.0.0.1", r));
    try {
      const porta = (calado.address() as net.AddressInfo).port;
      const c = new ClienteHikvision({ nome: "Calado", ip: "127.0.0.1", porta, usuario: "admin", senha: "x", porta_acesso: 1, leitores_digital: [1] }, { timeoutMs: 150, tentativas: 2, esperaMs: 1 });
      await expect(c.xml("GET", "/ISAPI/System/deviceInfo")).rejects.toThrow(/Calado: o aparelho não respondeu em 0,15 s/);
    } finally {
      calado.close();
    }
  });

  it("cadastra com o nome 'Aluno' e a situação do cache; nunca o CPF; repetir só atualiza", async () => {
    const a = await novoAparelho();
    await montar([eq(a, "Catraca")]);
    await amb.cache.substituirTodos([aluno("42", true)]);
    await gestao.criarUsuario(42);
    const u = a.usuarios.get("42")!;
    expect(u).toMatchObject({ employeeNo: "42", name: "Aluno" });
    expect(JSON.stringify(u)).not.toContain(aluno("42").cpf);
    expect(a.dentroDaValidade("42")).toBe(false);
    await amb.cache.substituirTodos([aluno("42", false)]);
    await gestao.criarUsuario(42);
    expect(a.dentroDaValidade("42")).toBe(true);
  });

  it("firmware sem o 'aplicar': inclui, e altera quando o aluno já existe", async () => {
    const a = await novoAparelho();
    a.semFuncao.add("/ISAPI/AccessControl/UserInfo/SetUp");
    await montar([eq(a, "Catraca")]);
    await gestao.criarUsuario(8);
    await gestao.criarUsuario(8);
    const caminhos = a.chamadas.map((c) => `${c.metodo} ${c.caminho.split("?")[0]}`).filter((c) => /UserInfo\//.test(c));
    expect(caminhos).toEqual([
      "PUT /ISAPI/AccessControl/UserInfo/SetUp",
      "POST /ISAPI/AccessControl/UserInfo/Record",
      "PUT /ISAPI/AccessControl/UserInfo/SetUp",
      "POST /ISAPI/AccessControl/UserInfo/Record",
      "PUT /ISAPI/AccessControl/UserInfo/Modify",
    ]);
  });

  it("espelho: barra e libera só quem mudou, e ignora quem não está no aparelho", async () => {
    const a = await novoAparelho();
    await montar([eq(a, "Catraca")]);
    await gestao.criarUsuario(1);
    await gestao.criarUsuario(2);
    // O 3 tem número no ARKE e não está neste aparelho.
    await amb.cache.substituirTodos([aluno("1"), aluno("2", true), aluno("3", true)]);
    const r = await conector.espelhar();
    expect(r[0].falhou).toBeUndefined();
    expect(a.dentroDaValidade("1")).toBe(true);
    expect(a.dentroDaValidade("2")).toBe(false);
    expect(a.usuarios.has("3")).toBe(false);
    const antes = a.chamadas.length;
    await conector.espelhar();
    expect(a.chamadas.length).toBe(antes);
    await amb.cache.substituirTodos([aluno("1", true), aluno("2", true), aluno("3", true)]);
    await conector.espelhar();
    expect(a.dentroDaValidade("1")).toBe(false);
    expect(a.chamadas.slice(antes).map((c) => (c.corpo as { UserInfo: { employeeNo: string } }).UserInfo.employeeNo)).toEqual(["1"]);
  });

  it("foto do app: vai aos aparelhos com rosto, ligada ao número; foto sem rosto vira erro claro", async () => {
    const t = await novoAparelho("terminal");
    const c = await novoAparelho("controladora");
    await montar([eq(t, "Terminal"), eq(c, "Controladora")]);
    const r = await gestao.enviarFotoRosto(9, AparelhoHikvisionFalso.jpeg(5000));
    expect(r.equipamentos).toEqual(["Terminal"]);
    expect(t.rostos.get("9")).toBe(5006);
    expect(t.partesDoUltimoRosto).toEqual([
      { nome: "FaceDataRecord", tipo: "application/json" },
      { nome: "img", tipo: "image/jpeg" },
    ]);
    await expect(gestao.enviarFotoRosto(9, Buffer.alloc(2000, 1))).rejects.toThrow(/nenhum rosto encontrado na foto \(pictureFaceDetectZero\)/);
  });

  it("rosto pela câmera: a foto capturada vai a todos os aparelhos com rosto", async () => {
    const t1 = await novoAparelho("terminal");
    const t2 = await novoAparelho("terminal_sem_digital");
    await montar([eq(t1, "Entrada"), eq(t2, "Saída")]);
    expect(gestao.temRosto("Entrada")).toBe(true);
    const r = await gestao.cadastrarRosto(10, "Entrada");
    expect(r).toEqual({ equipamento: "Entrada", replicado_em: ["Saída"], falhou_em: [] });
    expect(t1.rostos.has("10")).toBe(true);
    expect(t2.rostos.has("10")).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/ffd8|base64/i);
  });

  it("digital: lida no aparelho escolhido e copiada aos que têm leitor; o recadastro troca a antiga", async () => {
    const t = await novoAparelho("terminal");
    const s = await novoAparelho("terminal_sem_digital");
    const c = await novoAparelho("controladora");
    await montar([eq(t, "Terminal"), eq(s, "Sem digital"), eq(c, "Controladora", { leitores_digital: [1, 3] })]);
    const r = await gestao.cadastrarDigital(11);
    expect(r).toEqual({ equipamento: "Terminal", replicado_em: ["Controladora"], falhou_em: [] });
    expect(t.digitais.get("11")).toBe(t.digitalParaLer);
    expect(c.digitais.get("11")).toBe(t.digitalParaLer);
    expect(s.digitais.has("11")).toBe(false);
    expect(JSON.stringify(r)).not.toContain(t.digitalParaLer!);
    t.digitalParaLer = Buffer.from("dedo-novo").toString("base64");
    await gestao.cadastrarDigital(11, "Terminal");
    expect(c.digitais.get("11")).toBe(t.digitalParaLer);
    // A digital lida mal vira frase clara, e nada é gravado.
    t.digitalParaLer = null;
    await expect(gestao.cadastrarDigital(12)).rejects.toThrow(/digital saiu fraca/);
  });

  it("cartão: lido e copiado no lugar do anterior; cartão de outra pessoa é recusado", async () => {
    const t = await novoAparelho("terminal");
    const c = await novoAparelho("controladora");
    await montar([eq(t, "Terminal"), eq(c, "Controladora")]);
    const r = await gestao.cadastrarCartao(12);
    expect(r).toEqual({ equipamento: "Terminal", cartoes: 1, replicado_em: ["Controladora"], falhou_em: [] });
    expect(JSON.stringify(r)).not.toContain("3141592653");
    expect(c.cartoes.get("3141592653")).toBe("12");
    t.cartaoParaLer = "2718281828";
    await gestao.cadastrarCartao(12);
    expect([...t.cartoes.entries()]).toEqual([["2718281828", "12"]]);
    await expect(gestao.cadastrarCartao(13)).rejects.toThrow(/já está cadastrado para outra pessoa/);
  });

  it("revogar apaga o rosto, a digital, o cartão e o aluno; repetir conta como feito", async () => {
    const t = await novoAparelho("terminal");
    await montar([eq(t, "Terminal")]);
    await gestao.enviarFotoRosto(7, AparelhoHikvisionFalso.jpeg(3000));
    await gestao.cadastrarDigital(7);
    await gestao.cadastrarCartao(7);
    expect([t.rostos.has("7"), t.digitais.has("7"), t.cartoes.size]).toEqual([true, true, 1]);
    const antes = t.chamadas.length;
    const r = await gestao.apagarUsuario(7);
    expect(r).toEqual({ equipamentos: ["Terminal"], apagados: 1 });
    expect([t.usuarios.has("7"), t.rostos.has("7"), t.digitais.has("7"), t.cartoes.size]).toEqual([false, false, false, 0]);
    // O rosto e a digital saem antes da pessoa, cada um pela própria chamada.
    const ordem = t.chamadas
      .slice(antes)
      .map((c) => c.caminho.split("?")[0])
      .filter((c) => /Delete$/.test(c));
    expect(ordem).toEqual([
      "/ISAPI/Intelligent/FDLib/FDSearch/Delete",
      "/ISAPI/AccessControl/FingerPrint/Delete",
      "/ISAPI/AccessControl/CardInfo/Delete",
      "/ISAPI/AccessControl/UserInfoDetail/Delete",
    ]);
    await expect(gestao.apagarUsuario(7)).resolves.toEqual({ equipamentos: ["Terminal"], apagados: 1 });
  });

  it("abre a porta configurada", async () => {
    const c = await novoAparelho("controladora");
    await montar([eq(c, "Controladora", { porta_acesso: 2 })]);
    expect(await gestao.liberarCatraca("entrada")).toEqual({ equipamento: "Controladora" });
    expect(c.portasAbertas).toEqual([2]);
  });

  it("aparelho fora do ar: a ordem falha com a frase, e a conferência seguinte reconfigura quando ele volta", async () => {
    const a = await novoAparelho();
    const lista = [eq(a, "Catraca")];
    await a.parar();
    await montar(lista);
    expect(conector.estados()[0]).toMatchObject({ alcancavel: false });
    await expect(gestao.criarUsuario(1)).rejects.toThrow(/recusou a conexão/);
    // O mesmo aparelho volta na mesma porta.
    await new Promise<void>((r) => (a as unknown as { servidor: import("node:http").Server }).servidor.listen(lista[0].porta, "127.0.0.1", r));
    await conector.verificar();
    expect(conector.estados()[0]).toMatchObject({ alcancavel: true, verificacaoRemota: true });
    expect(a.servidorDeEventos?.porta).toBe(4571);
  });
});

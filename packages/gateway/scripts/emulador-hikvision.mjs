#!/usr/bin/env node
/**
 * Emulador de um aparelho de controle de acesso da Hikvision (ISAPI) — faz o
 * papel do equipamento para um Gateway rodando, sem hardware.
 *
 * Dois tipos: o terminal facial (como o DS-K1T671MF, com rosto, cartão e
 * digital) e a controladora DS-K2604 (sem câmera; cartão e digital pelos
 * leitores; com --facial, um terminal facial ligado a ela).
 *
 * Serve a API ISAPI com autenticação Digest (a que o Gateway usa para ler o
 * aparelho, acertar a hora, apontar o servidor de eventos, ligar a
 * verificação remota, cadastrar e apagar o aluno, o rosto, o cartão e a
 * digital, e abrir a porta) e faz o papel do aparelho no servidor de escuta:
 * cada acesso vai num POST ao Gateway e, com a verificação remota, a decisão
 * volta na resposta. Sem o Gateway, decide pela lista que tem (a validade de
 * cada pessoa) e guarda o evento para reenviar quando ele voltar.
 *
 * Escrito a partir da documentação ISAPI da Hikvision, sem importar o código
 * do Gateway; as respostas são escritas aqui.
 *
 * O que ele NÃO substitui: o reconhecimento do rosto e da digital, o tempo
 * real do aparelho, o relé ligado à catraca e o que cada firmware faz de
 * diferente. Isso é o teste no aparelho de verdade.
 *
 * Uso:
 *   node scripts/emulador-hikvision.mjs --http 8091 --senha Senha12345
 *   node scripts/emulador-hikvision.mjs --tipo controladora --http 8092
 *   node scripts/emulador-hikvision.mjs --http 8091 --ler "r 1, c 999, d 1, s 1, q 12, h 1" --sair
 *
 * No config.json do Gateway:
 *   "modelo_catraca": "hikvision",
 *   "hikvision_equipamentos": [{ "nome": "Catraca", "ip": "127.0.0.1", "porta": 8091, "senha": "Senha12345" }]
 *
 * Comandos: r <número> (rosto reconhecido), x (rosto desconhecido),
 *   d <número> (digital), c <cartão> (cartão lido), s <número> (saída, leitor 2),
 *   q <texto> (QR), h <número> (registro guardado de uma hora atrás),
 *   u (pessoas no aparelho), ocupado <n> (as próximas n chamadas respondem
 *   "ocupado"), nonce (troca o nonce do Digest), sair.
 */

import http from "node:http";
import readline from "node:readline";
import { createHash, randomBytes } from "node:crypto";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const porta = Number(args.http ?? 8091);
const usuario = args.usuario ?? "admin";
const senha = args.senha ?? "Senha12345";
const tipo = args.tipo === "controladora" ? "controladora" : "terminal";
const temRosto = tipo === "terminal" || !!args.facial;
const modelo = tipo === "controladora" ? "DS-K2604" : "DS-K1T671MF";
const realm = `${modelo}-EMULADOR`;
let nonce = randomBytes(12).toString("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const pessoas = new Map(); // número → { Valid, name }
const rostos = new Map(); // número → bytes
const cartoes = new Map(); // cartão → número
const digitais = new Map(); // número → dados
let acsCfg = { uploadVerificationPic: true, saveVerificationPic: true, saveFacePic: true, showName: true };
let servidor = null; // { host, porta, url }
let ocupadoPor = 0;
let serial = 1000;
const guardados = []; // eventos que não chegaram ao Gateway (reenvio automático)
let ultimaDigital = 1;

function digestValido(cab, metodo, uri) {
  if (!cab?.startsWith("Digest ")) return false;
  const c = (n) => new RegExp(`(?:^|[\\s,])${n}="?([^",]+)"?`).exec(cab.slice(6))?.[1];
  if (c("username") !== usuario || c("nonce") !== nonce || c("uri") !== uri) return false;
  const ha1 = md5(`${usuario}:${realm}:${senha}`);
  return c("response") === md5(`${ha1}:${nonce}:${c("nc")}:${c("cnonce")}:auth:${md5(`${metodo}:${uri}`)}`);
}

// Os erros no formato do aparelho: [http, statusCode, statusString, subStatusCode, errorCode].
const ERRO = {
  naoExiste: [400, 6, "Invalid Content", "employeeNoNotExist", 0x6000601f],
  jaExiste: [400, 6, "Invalid Content", "employeeNoAlreadyExist", 0x60006020],
  cartaoDeOutro: [400, 6, "Invalid Content", "cardNoAlreadyExist", 0x60006033],
  semRosto: [400, 6, "Invalid Content", "pictureFaceDetectZero", 0x6000604c],
  semFuncao: [403, 4, "Invalid Operation", "notSupport", 0x40000001],
  ocupado: [503, 2, "Device Busy", "deviceBusy", 0x20000004],
  formato: [400, 5, "Invalid Format", "badJsonFormat", 0x50000002],
};

const responder = (res, status, tipoConteudo, corpo) => {
  res.writeHead(status, { "Content-Type": tipoConteudo, "Content-Length": Buffer.byteLength(corpo) });
  res.end(corpo);
};
const ok = (res, extra = {}) => responder(res, 200, "application/json", JSON.stringify({ statusCode: 1, statusString: "OK", subStatusCode: "ok", ...extra }));
const okJson = (res, j) => responder(res, 200, "application/json", JSON.stringify(j));
const okXml = (res, x) => responder(res, 200, "application/xml", `<?xml version="1.0" encoding="UTF-8"?>\n${x}`);
const erro = (res, [st, codigo, texto, sub, numero]) => {
  log(`  ↳ ERRO devolvido ao Gateway: ${sub}`);
  responder(res, st, "application/json", JSON.stringify({ statusCode: codigo, statusString: texto, subStatusCode: sub, errorCode: numero, errorMsg: sub }));
};

function partesMultipart(corpo, contentType) {
  const fronteira = /boundary="?([^";]+)"?/i.exec(contentType ?? "")?.[1];
  if (!fronteira) return [];
  const marca = Buffer.from(`--${fronteira}`);
  const saida = [];
  let pos = corpo.indexOf(marca);
  while (pos >= 0) {
    const ini = pos + marca.length;
    if (corpo.subarray(ini, ini + 2).toString() === "--") break;
    const prox = corpo.indexOf(marca, ini);
    const bloco = corpo.subarray(ini, prox < 0 ? corpo.length : prox);
    pos = prox;
    const fim = bloco.indexOf("\r\n\r\n");
    if (fim < 0) continue;
    const cab = bloco.subarray(0, fim).toString("latin1");
    const tam = Number(/content-length:\s*(\d+)/i.exec(cab)?.[1] ?? NaN);
    const dados = Number.isFinite(tam) ? bloco.subarray(fim + 4, fim + 4 + tam) : bloco.subarray(fim + 4, bloco.length - 2);
    saida.push({ nome: /name="?([^";\r\n]+)"?/i.exec(cab)?.[1] ?? null, tipo: /content-type:\s*([^;\r\n]+)/i.exec(cab)?.[1]?.trim() ?? null, dados });
  }
  return saida;
}

const sim = (v) => (v ? "true" : "false");
function capacidades() {
  const c = tipo === "controladora";
  return (
    `<AccessControl version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">` +
    `<isSupportUserInfo>true</isSupportUserInfo><isSupportCardInfo>true</isSupportCardInfo>` +
    `<isSupportFDLib>${sim(temRosto)}</isSupportFDLib><isSupportFingerPrintCfg>true</isSupportFingerPrintCfg>` +
    `<isSupportFingerPrintDelete>true</isSupportFingerPrintDelete><isSupportCaptureCardInfo>${sim(!c)}</isSupportCaptureCardInfo>` +
    `<isSupportCaptureFace>${sim(!c)}</isSupportCaptureFace><isSupportCaptureFingerPrint>${sim(!c)}</isSupportCaptureFingerPrint>` +
    `<isSupportRemoteCheck>${sim(!c && !args["sem-verificacao"])}</isSupportRemoteCheck><isSupportAcsCfg>true</isSupportAcsCfg>` +
    `<isSupportUserInfoDetailDelete>true</isSupportUserInfoDetailDelete></AccessControl>`
  );
}

const FOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(3000), Buffer.from([0xff, 0xd9])]);

function apagarTudo(id) {
  const tinha = [pessoas.has(id) && "pessoa", rostos.has(id) && "rosto", digitais.has(id) && "digital", [...cartoes.values()].includes(id) && "cartão"].filter(Boolean);
  pessoas.delete(id);
  rostos.delete(id);
  digitais.delete(id);
  for (const [n, p] of cartoes) if (p === id) cartoes.delete(n);
  return tinha;
}

function atender(metodo, uri, corpo, bruto, contentType, res) {
  const [caminho, consulta = ""] = uri.split("?");
  const q = new URLSearchParams(consulta);
  const j = corpo ?? {};
  switch (`${metodo} ${caminho}`) {
    case "GET /ISAPI/System/deviceInfo":
      return okXml(
        res,
        `<DeviceInfo version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><deviceName>Emulador</deviceName><model>${modelo}</model>` +
          `<serialNumber>${modelo}EMULADOR0001</serialNumber><firmwareVersion>V3.9.0</firmwareVersion><deviceType>ACS</deviceType></DeviceInfo>`
      );
    case "GET /ISAPI/AccessControl/capabilities":
      return okXml(res, capacidades());
    case "PUT /ISAPI/System/time":
      log(`HORA acertada pelo Gateway: ${/<localTime>([^<]+)</.exec(String(corpo))?.[1]} (fuso ${/<timeZone>([^<]+)</.exec(String(corpo))?.[1]})`);
      return ok(res);
    case "PUT /ISAPI/Event/notification/httpHosts": {
      const x = String(corpo);
      const tag = (n) => new RegExp(`<${n}>([^<]*)<`).exec(x)?.[1];
      servidor = { host: tag("ipAddress") ?? tag("ipv6Address"), porta: Number(tag("portNo")), url: tag("url") };
      log(`SERVIDOR DE EVENTOS: http://${servidor.host}:${servidor.porta}${servidor.url} (${tag("parameterFormatType")}, reenvio ${tag("httpBroken") === "true" ? "ligado" : "desligado"})`);
      return ok(res);
    }
    case "GET /ISAPI/AccessControl/AcsCfg":
      return okJson(res, { AcsCfg: acsCfg });
    case "PUT /ISAPI/AccessControl/AcsCfg":
      acsCfg = { ...(j.AcsCfg ?? {}) };
      log(
        `CONFIGURAÇÃO DE ACESSO: verificação remota ${acsCfg.remoteCheckDoorEnabled ? `ligada (${acsCfg.checkChannelType}, ${acsCfg.remoteCheckWithISAPIListen}, ${acsCfg.remoteCheckTimeout} s, sem o Gateway ${acsCfg.offlineDevCheckOpenDoorEnabled ? "decide sozinho" : "nega"})` : "desligada"}; foto de cada acesso ${acsCfg.uploadVerificationPic === false ? "desligada" : "ligada"}`
      );
      return ok(res);
    case "PUT /ISAPI/AccessControl/UserInfo/SetUp":
    case "POST /ISAPI/AccessControl/UserInfo/Record":
    case "PUT /ISAPI/AccessControl/UserInfo/Modify": {
      const u = j.UserInfo;
      if (!u?.employeeNo) return erro(res, ERRO.formato);
      const existe = pessoas.has(u.employeeNo);
      if (caminho.endsWith("Record") && existe) return erro(res, ERRO.jaExiste);
      if (caminho.endsWith("Modify") && !existe) return erro(res, ERRO.naoExiste);
      pessoas.set(u.employeeNo, u);
      log(`PESSOA ${existe ? "atualizada" : "cadastrada"}: ${u.employeeNo}, nome na tela "${u.name}", ${valido(u.employeeNo) ? "dentro da validade" : "FORA DA VALIDADE (barrada)"}`);
      return ok(res);
    }
    case "PUT /ISAPI/AccessControl/UserInfo/Delete":
    case "PUT /ISAPI/AccessControl/UserInfoDetail/Delete": {
      const lista = (j.UserInfoDetail ?? j.UserInfoDelCond)?.EmployeeNoList ?? [];
      for (const e of lista) {
        const tinha = apagarTudo(e.employeeNo);
        log(`PESSOA APAGADA: ${e.employeeNo}${tinha.length ? ` (${tinha.join(", ")})` : " (já não estava)"}`);
      }
      return ok(res);
    }
    case "GET /ISAPI/AccessControl/UserInfoDetail/DeleteProcess":
      return okJson(res, { UserInfoDetailDeleteProcess: { status: "success" } });
    case "POST /ISAPI/AccessControl/CardInfo/Record": {
      const c = j.CardInfo ?? {};
      if (!pessoas.has(c.employeeNo)) return erro(res, ERRO.naoExiste);
      const dono = cartoes.get(c.cardNo);
      if (dono && dono !== c.employeeNo) return erro(res, ERRO.cartaoDeOutro);
      cartoes.set(c.cardNo, c.employeeNo);
      log(`CARTÃO ligado à pessoa ${c.employeeNo}`);
      return ok(res);
    }
    case "PUT /ISAPI/AccessControl/CardInfo/Delete": {
      for (const e of j.CardInfoDelCond?.EmployeeNoList ?? []) for (const [n, p] of cartoes) if (p === e.employeeNo) cartoes.delete(n);
      return ok(res);
    }
    case "GET /ISAPI/AccessControl/CaptureCardInfo":
      if (tipo === "controladora") return erro(res, ERRO.semFuncao);
      log("LEITURA DE CARTÃO pedida pelo Gateway: cartão aproximado");
      return okJson(res, { CardInfo: { cardNo: args.cartao ?? "3141592653" } });
    case "POST /ISAPI/AccessControl/CaptureFingerPrint":
      if (tipo === "controladora") return erro(res, ERRO.semFuncao);
      log("LEITURA DE DIGITAL pedida pelo Gateway: dedo no leitor");
      return okXml(
        res,
        `<CaptureFingerPrint version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><fingerData>${randomBytes(48).toString("base64")}</fingerData>` +
          `<fingerNo>1</fingerNo><fingerPrintQuality>90</fingerPrintQuality></CaptureFingerPrint>`
      );
    case "POST /ISAPI/AccessControl/FingerPrintDownload": {
      const f = j.FingerPrintCfg ?? {};
      if (!pessoas.has(f.employeeNo)) return erro(res, ERRO.naoExiste);
      ultimaDigital = digitais.has(f.employeeNo) ? 6 : 1;
      if (ultimaDigital === 1) {
        digitais.set(f.employeeNo, f.fingerData);
        log(`DIGITAL gravada da pessoa ${f.employeeNo} nos leitores ${JSON.stringify(f.enableCardReader)} (o emulador não mostra o dado)`);
      } else log(`DIGITAL recusada: a pessoa ${f.employeeNo} já tem o dedo 1 gravado`);
      return ok(res);
    }
    case "GET /ISAPI/AccessControl/FingerPrintProgress":
      return okJson(res, { FingerPrintStatus: { totalStatus: 1, StatusList: [{ id: 1, cardReaderRecvStatus: ultimaDigital }] } });
    case "PUT /ISAPI/AccessControl/FingerPrint/Delete": {
      const id = j.FingerPrintDelete?.EmployeeNoDetail?.employeeNo;
      if (id && digitais.delete(id)) log(`DIGITAL apagada da pessoa ${id}`);
      return ok(res);
    }
    case "GET /ISAPI/AccessControl/FingerPrint/DeleteProcess":
      return okJson(res, { FingerPrintDeleteProcess: { status: "success" } });
    case "PUT /ISAPI/Intelligent/FDLib/FDSetUp":
    case "POST /ISAPI/Intelligent/FDLib/FaceDataRecord":
    case "PUT /ISAPI/Intelligent/FDLib/FDModify": {
      if (!temRosto) return erro(res, ERRO.semFuncao);
      const partes = partesMultipart(bruto, contentType);
      const dados = partes.find((p) => /json/i.test(p.tipo ?? ""));
      const img = partes.find((p) => /image/i.test(p.tipo ?? ""));
      let r = null;
      try {
        r = JSON.parse(dados?.dados.toString("utf8") ?? "");
      } catch {
        return erro(res, ERRO.formato);
      }
      if (!r?.FPID || r.FDID !== "1") return erro(res, ERRO.formato);
      if (!pessoas.has(r.FPID)) return erro(res, ERRO.naoExiste);
      if (!img || img.dados.length < 1024 || img.dados[0] !== 0xff || img.dados[1] !== 0xd8) return erro(res, ERRO.semRosto);
      rostos.set(r.FPID, img.dados.length);
      log(`ROSTO gravado da pessoa ${r.FPID}: JPEG de ${img.dados.length} bytes (o emulador não guarda a foto)`);
      return ok(res, { FPID: r.FPID });
    }
    case "PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete": {
      if (!temRosto) return erro(res, ERRO.semFuncao);
      if (q.get("FDID") !== "1") return erro(res, ERRO.formato);
      for (const f of j.FPID ?? []) if (rostos.delete(f.value)) log(`ROSTO apagado da pessoa ${f.value}`);
      return ok(res);
    }
    case "POST /ISAPI/AccessControl/CaptureFaceData": {
      if (!temRosto || tipo === "controladora") return erro(res, ERRO.semFuncao);
      log("CÂMERA: rosto capturado a pedido do Gateway");
      const xml = `<CaptureFaceData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema"><captureProgress>100</captureProgress></CaptureFaceData>`;
      const f = "fronteiraEmulador";
      const corpoResp = Buffer.concat([
        Buffer.from(`--${f}\r\nContent-Disposition: form-data; name="CaptureFace"\r\nContent-Type: application/xml\r\nContent-Length: ${xml.length}\r\n\r\n${xml}\r\n`),
        Buffer.from(`--${f}\r\nContent-Disposition: form-data; name="FaceData"; filename="FaceData.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${FOTO.length}\r\n\r\n`),
        FOTO,
        Buffer.from(`\r\n--${f}--\r\n`),
      ]);
      res.writeHead(200, { "Content-Type": `multipart/form-data; boundary=${f}`, "Content-Length": corpoResp.length });
      return res.end(corpoResp);
    }
    default:
      if (metodo === "PUT" && caminho.startsWith("/ISAPI/AccessControl/RemoteControl/door/")) {
        if (!/<cmd>open<\/cmd>/.test(String(corpo))) return erro(res, ERRO.formato);
        log(`PORTA ${caminho.split("/").pop()} ABERTA remotamente`);
        return ok(res);
      }
      return erro(res, ERRO.semFuncao);
  }
}

http
  .createServer((req, res) => {
    const partes = [];
    req.on("data", (d) => partes.push(d));
    req.on("end", () => {
      const uri = req.url ?? "";
      const metodo = req.method ?? "GET";
      if (!digestValido(req.headers.authorization, metodo, uri)) {
        if (req.headers.authorization) log("SENHA recusada");
        res.writeHead(401, { "WWW-Authenticate": `Digest qop="auth", realm="${realm}", nonce="${nonce}", stale="FALSE"` });
        return res.end();
      }
      const bruto = Buffer.concat(partes);
      const ct = String(req.headers["content-type"] ?? "");
      let corpo = null;
      if (/json/i.test(ct)) {
        try {
          corpo = JSON.parse(bruto.toString("utf8"));
        } catch {
          return erro(res, ERRO.formato);
        }
      } else if (/xml/i.test(ct)) corpo = bruto.toString("utf8");
      if (ocupadoPor > 0) {
        ocupadoPor--;
        return erro(res, ERRO.ocupado);
      }
      atender(metodo, uri, corpo, bruto, ct, res);
    });
  })
  .listen(porta, "0.0.0.0", () => log(`Aparelho Hikvision emulado (${modelo}${tipo === "controladora" && temRosto ? " com terminal facial" : ""}): ISAPI em :${porta}, usuário ${usuario}`));

// ——— O aparelho chamando o Gateway ———

function valido(id) {
  const v = pessoas.get(id)?.Valid;
  if (!pessoas.has(id)) return false;
  if (!v?.enable) return true;
  // A validade é na hora local do aparelho, como ele grava.
  const agora = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date()).replace(" ", "T");
  return v.beginTime <= agora && agora <= v.endTime;
}

function corpoEvento(dados, quando = new Date()) {
  const json = JSON.stringify({
    ipAddress: "127.0.0.1",
    portNo: porta,
    protocol: "HTTP",
    channelID: 1,
    dateTime: quando.toISOString(),
    activePostCount: 1,
    eventType: "AccessControllerEvent",
    AccessControllerEvent: { deviceName: modelo, majorEventType: 5, cardReaderNo: 1, doorNo: 1, serialNo: ++serial, currentEvent: true, ...dados },
  });
  const f = "MIME_boundary";
  const partes = [Buffer.from(`--${f}\r\nContent-Disposition: form-data; name="AccessControllerEvent"\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`)];
  // A foto de cada acesso, se o Gateway não a tiver desligado.
  if (acsCfg.uploadVerificationPic !== false && dados.employeeNoString) {
    partes.push(Buffer.from(`--${f}\r\nContent-Disposition: form-data; name="Picture"; filename="Picture.jpg"\r\nContent-Type: image/jpeg\r\nContent-Length: ${FOTO.length}\r\n\r\n`), FOTO, Buffer.from("\r\n"));
  }
  partes.push(Buffer.from(`--${f}--\r\n`));
  return { corpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${f}` };
}

function postar(dados, quando) {
  return new Promise((resolve, reject) => {
    if (!servidor) return reject(new Error("o Gateway ainda não configurou o servidor de eventos"));
    const { corpo, tipo: ct } = corpoEvento(dados, quando);
    const espera = (acsCfg.remoteCheckTimeout ?? 5) * 1000;
    const req = http.request(
      { host: servidor.host, port: servidor.porta, path: servidor.url, method: "POST", headers: { "Content-Type": ct, "Content-Length": corpo.length }, timeout: espera },
      (r) => {
        const p = [];
        r.on("data", (d) => p.push(d));
        r.on("end", () => resolve({ status: r.statusCode, texto: Buffer.concat(p).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`sem resposta em ${espera / 1000} s`)));
    req.on("error", reject);
    req.write(corpo);
    req.end();
  });
}

async function reenviarGuardados() {
  while (guardados.length) {
    const ev = guardados[0];
    try {
      const r = await postar({ ...ev.dados, currentEvent: false, remoteCheck: false }, ev.quando);
      if (r.status !== 200) return;
      guardados.shift();
      log(`REENVIO: evento guardado de ${ev.quando.toISOString().slice(11, 19)} entregue ao Gateway`);
    } catch {
      return;
    }
  }
}
setInterval(() => void reenviarGuardados(), 10_000).unref();

const verificacaoRemota = () => acsCfg.remoteCheckDoorEnabled === true && acsCfg.checkChannelType === "ISAPIListen";

/**
 * Uma tentativa de acesso. `id` é a pessoa que o aparelho reconheceu (ou
 * null); `menorOk`/`menorNegado`, os códigos do evento de cada desfecho
 * local; `pergunta`, se esta credencial pede a verificação remota.
 */
async function tentar(rotulo, { id, cartao = null, menorOk, menorNegado, pergunta, leitor = 1, extra = {} }) {
  const local = id ? valido(id) : false;
  const dados = { subEventType: local ? menorOk : menorNegado, cardReaderNo: leitor, ...extra };
  if (id) Object.assign(dados, { employeeNoString: id, name: pessoas.get(id)?.name ?? "" });
  if (cartao) dados.cardNo = cartao;
  if (pergunta && verificacaoRemota()) {
    const t0 = Date.now();
    try {
      await reenviarGuardados();
      const r = await postar({ ...dados, remoteCheck: true });
      const j = JSON.parse(r.texto || "{}").RemoteCheck ?? {};
      const liberado = j.checkResult === "success";
      log(`${rotulo} → ${liberado ? "LIBERADO" : "NEGADO"} pelo Gateway em ${Date.now() - t0} ms  (tela: "${j.info ?? ""}")`);
      return;
    } catch (e) {
      // Sem o Gateway: decide pela lista que tem, se a configuração deixar.
      const abre = acsCfg.offlineDevCheckOpenDoorEnabled === true && local;
      log(`${rotulo} → sem resposta do Gateway (${e.message}): o aparelho decide sozinho → ${abre ? "LIBERADO" : "NEGADO"}; evento guardado para reenvio`);
      guardados.push({ dados: { ...dados, subEventType: abre ? menorOk : menorNegado }, quando: new Date() });
      return;
    }
  }
  // Decidido no aparelho (a digital, ou sem a verificação remota): avisa depois.
  log(`${rotulo} → ${local ? "LIBERADO" : "NEGADO"} pelo próprio aparelho (pela lista e pela validade)`);
  try {
    await postar(dados);
  } catch {
    guardados.push({ dados, quando: new Date() });
  }
}

async function executar(linha) {
  const [cmd, valor] = linha.trim().split(/\s+/);
  if (!cmd) return;
  if (cmd === "r") {
    if (!temRosto) return log("Este aparelho não tem câmera.");
    return tentar(`ROSTO da pessoa ${valor}`, { id: rostos.has(valor) ? valor : null, menorOk: 0x4b, menorNegado: 0x4c, pergunta: true });
  }
  if (cmd === "x") return tentar("ROSTO desconhecido", { id: null, menorOk: 0x4b, menorNegado: 0x4c, pergunta: true });
  if (cmd === "d") return tentar(`DIGITAL da pessoa ${valor}`, { id: digitais.has(valor) ? valor : null, menorOk: 0x26, menorNegado: 0x27, pergunta: false });
  if (cmd === "c") {
    const dono = cartoes.get(valor) ?? null;
    return tentar(`CARTÃO ${dono ? `da pessoa ${dono}` : "sem dono no aparelho"}`, { id: dono, cartao: valor, menorOk: 0x01, menorNegado: 0x09, pergunta: true });
  }
  if (cmd === "s") return tentar(`SAÍDA da pessoa ${valor} (leitor 2)`, { id: valor, menorOk: 0x01, menorNegado: 0x06, pergunta: true, leitor: 2 });
  if (cmd === "q") return tentar(`QR "${valor}"`, { id: null, cartao: valor, menorOk: 0x9c, menorNegado: 0x9d, pergunta: true, extra: { swipeCardType: 1, cardReaderKind: 3 } });
  if (cmd === "h") {
    const quando = new Date(Date.now() - 3600_000);
    const r = await postar({ subEventType: 0x4b, employeeNoString: valor, currentEvent: false }, quando).catch((e) => ({ status: 0, texto: e.message }));
    return log(`HISTÓRICO enviado (rosto da pessoa ${valor}, uma hora atrás) → HTTP ${r.status}`);
  }
  if (cmd === "u") {
    const linhas = [...pessoas.keys()].map(
      (id) => `${id} "${pessoas.get(id).name}" ${valido(id) ? "válida" : "FORA DA VALIDADE"}${rostos.has(id) ? " +rosto" : ""}${digitais.has(id) ? " +digital" : ""}${[...cartoes.values()].includes(id) ? " +cartão" : ""}`
    );
    return log(`PESSOAS: ${linhas.join("; ") || "nenhuma"}`);
  }
  if (cmd === "ocupado") {
    ocupadoPor = Number(valor ?? 1);
    return log(`As próximas ${ocupadoPor} chamadas respondem "ocupado".`);
  }
  if (cmd === "nonce") {
    nonce = randomBytes(12).toString("hex");
    return log("Nonce do Digest trocado.");
  }
  if (cmd === "sair") process.exit(0);
  log(`Comando desconhecido: ${cmd}`);
}

if (args.ler) {
  const espera = () => new Promise((r) => setTimeout(r, 400));
  (async () => {
    while (!servidor) await espera();
    for (const c of String(args.ler).split(",")) {
      await executar(c);
      await espera();
    }
    if (args.sair) process.exit(0);
  })();
}
readline.createInterface({ input: process.stdin }).on("line", (l) => void executar(l));

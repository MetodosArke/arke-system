#!/usr/bin/env node
/**
 * Emulador do terminal de acesso da Intelbras (linha Bio-T, Modo Online) —
 * faz o papel do equipamento para um Gateway rodando, sem hardware.
 *
 * Serve a API CGI do terminal com autenticação Digest (a que o Gateway usa
 * para configurar o Modo Online, acertar a hora, cadastrar e apagar o aluno,
 * receber a foto do rosto e abrir a porta), e faz o papel do terminal no
 * Modo Online: quando o Gateway configura o servidor de eventos, o emulador
 * passa a chamar o keepalive a cada 10 s e manda cada tentativa de acesso
 * em multipart, com uma foto, como o terminal manda.
 *
 * Escrito a partir da documentação de integração da Intelbras (coleção
 * oficial do portal e os exemplos de github.com/integracaoca), sem importar
 * o código do Gateway.
 *
 * O que ele NÃO substitui: o reconhecimento do rosto e da digital, o tempo
 * real de resposta do terminal, o relé ligado à catraca e o que o terminal
 * faz sem o servidor (a Intelbras confirmou em 05/10/2026 que o bloqueado,
 * `UserType` 1, não entra). Isso é bancada.
 *
 * Uso:
 *   node scripts/emulador-intelbras.mjs --http 8090 --senha admin123
 *   node scripts/emulador-intelbras.mjs --http 8090 --ler "r 42, c 12AB, s 42" --sair
 *
 * No config.json do Gateway:
 *   "modelo_catraca": "intelbras",
 *   "intelbras_equipamentos": [{ "nome": "Catraca", "ip": "127.0.0.1", "porta": 8090, "senha": "admin123" }]
 *
 * Comandos: r <número> (rosto do usuário com esse número), b <número>
 *   (digital), c <cartão> (cartão lido sem usuário), s <número> (saída),
 *   h <número> (manda um registro guardado de uma hora atrás), u (lista os
 *   usuários do terminal), sair.
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
const porta = Number(args.http ?? 8090);
const usuario = args.usuario ?? "admin";
const senha = args.senha ?? "admin123";
const realm = "Login to EMULADOR";
const nonce = randomBytes(8).toString("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const usuarios = new Map();
const rostos = new Map();
let servidor = null; // { host, porta } que o Gateway configurou
let modoOnline = false;
let keepalive = null;

// UserType: 0 comum, 1 bloqueado, 5 acessibilidade (Intelbras, 05/10/2026).
function rotulo(u) {
  if (u.UserType === 1) return " (bloqueado)";
  if (u.UserType === 5) return " (ACESSIBILIDADE)";
  return "";
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function digestValido(cab, metodo, uri) {
  if (!cab?.startsWith("Digest ")) return false;
  const c = (n) => new RegExp(`${n}="?([^",]+)"?`).exec(cab)?.[1];
  if (c("username") !== usuario || c("nonce") !== nonce || c("uri") !== uri) return false;
  const ha1 = md5(`${usuario}:${realm}:${senha}`);
  const ha2 = md5(`${metodo}:${uri}`);
  return c("response") === md5(`${ha1}:${nonce}:${c("nc")}:${c("cnonce")}:auth:${ha2}`);
}

function atender(uri, corpo) {
  const q = new URL(uri, "http://x").searchParams;
  const acao = q.get("action");
  const OK = [200, "OK\r\n"];
  const ERRO = [400, "Error\r\n"];
  if (uri.startsWith("/cgi-bin/magicBox.cgi")) return [200, "version=2.000.EMULADOR.R\r\n"];
  if (uri.startsWith("/cgi-bin/global.cgi") && acao === "setCurrentTime") {
    log(`HORA acertada pelo Gateway: ${q.get("time")}`);
    return OK;
  }
  if (uri.startsWith("/cgi-bin/configManager.cgi") && acao === "setConfig") {
    const end = q.get("PictureHttpUpload.UploadServerList[0].Address");
    if (end) {
      servidor = { host: end, porta: Number(q.get("PictureHttpUpload.UploadServerList[0].Port")) };
      log(`SERVIDOR DE EVENTOS: ${servidor.host}:${servidor.porta}${q.get("PictureHttpUpload.UploadServerList[0].Uploadpath")}`);
    }
    if (q.get("Intelbras_ModeCfg.DeviceMode") === "2") {
      modoOnline = true;
      log(`MODO ONLINE ligado (keepalive a cada ${q.get("Intelbras_ModeCfg.KeepAlive.Interval")} s em ${q.get("Intelbras_ModeCfg.KeepAlive.Path")})`);
      iniciarKeepalive(Number(q.get("Intelbras_ModeCfg.KeepAlive.Interval") ?? 10));
    }
    return OK;
  }
  if (uri.startsWith("/cgi-bin/accessControl.cgi") && acao === "openDoor") {
    log(`PORTA ABERTA remotamente (relé ${q.get("channel")})`);
    return OK;
  }
  if (uri.startsWith("/cgi-bin/AccessUser.cgi")) {
    const lista = corpo?.UserList ?? [];
    if (acao === "insertMulti") {
      if (lista.some((u) => usuarios.has(String(u.UserID)))) return ERRO;
      for (const u of lista) usuarios.set(String(u.UserID), u);
      log(`USUÁRIO cadastrado: ${lista.map((u) => `${u.UserID}${rotulo(u)}`).join(", ")}`);
      return OK;
    }
    if (acao === "updateMulti") {
      if (lista.some((u) => !usuarios.has(String(u.UserID)))) return ERRO;
      for (const u of lista) usuarios.set(String(u.UserID), u);
      log(`USUÁRIO atualizado: ${lista.map((u) => `${u.UserID}${rotulo(u) || " (comum)"}`).join(", ")}`);
      return OK;
    }
    if (acao === "removeMulti") {
      const id = q.get("UserIDList[0]");
      const ok = usuarios.delete(id);
      if (ok) log(`USUÁRIO apagado: ${id}`);
      return ok ? OK : ERRO;
    }
  }
  if (uri.startsWith("/cgi-bin/AccessFace.cgi")) {
    if (acao === "removeMulti") {
      const id = q.get("UserIDList[0]");
      const ok = rostos.delete(id);
      if (ok) log(`ROSTO apagado: ${id}`);
      return ok ? OK : ERRO;
    }
    const f = corpo?.FaceList?.[0];
    if (!f || !usuarios.has(String(f.UserID))) return ERRO;
    const bytes = Buffer.from(f.PhotoData?.[0] ?? "", "base64");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > 100 * 1024) return ERRO;
    if (acao === "insertMulti" && rostos.has(String(f.UserID))) return ERRO;
    rostos.set(String(f.UserID), bytes.length);
    log(`ROSTO recebido do usuário ${f.UserID}: JPEG de ${bytes.length} bytes (a foto não é guardada pelo emulador)`);
    return OK;
  }
  return [404, "Not Found"];
}

http
  .createServer((req, res) => {
    const partes = [];
    req.on("data", (d) => partes.push(d));
    req.on("end", () => {
      const uri = req.url ?? "";
      if (!digestValido(req.headers.authorization, req.method ?? "GET", uri)) {
        if (req.headers.authorization) log("SENHA recusada");
        res.writeHead(401, { "WWW-Authenticate": `Digest realm="${realm}", qop="auth", nonce="${nonce}", opaque="emulador"` });
        return res.end();
      }
      let corpo = null;
      try {
        corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString("utf8")) : null;
      } catch {
        corpo = null;
      }
      const [status, texto] = atender(uri, corpo);
      res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(texto) });
      res.end(texto);
    });
  })
  .listen(porta, "0.0.0.0", () => log(`Terminal Intelbras emulado: API CGI em :${porta} (usuário ${usuario})`));

function chamarServidor(metodo, caminho, corpo, contentType) {
  return new Promise((resolve, reject) => {
    if (!servidor) return reject(new Error("o Gateway ainda não configurou o servidor de eventos"));
    const req = http.request(
      { host: servidor.host, port: servidor.porta, path: caminho, method: metodo, headers: corpo ? { "Content-Type": contentType, "Content-Length": corpo.length } : {}, timeout: 5000 },
      (r) => {
        const p = [];
        r.on("data", (d) => p.push(d));
        r.on("end", () => resolve({ status: r.statusCode, texto: Buffer.concat(p).toString("utf8") }));
      }
    );
    req.on("timeout", () => req.destroy(new Error("sem resposta em 5 s (RemoteCheckTimeout)")));
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function iniciarKeepalive(segundos) {
  if (keepalive) clearInterval(keepalive);
  const bater = () =>
    chamarServidor("GET", "/keepalive")
      .then((r) => r.status !== 200 && log(`KEEPALIVE: HTTP ${r.status} — o terminal passaria a decidir sozinho`))
      .catch((e) => log(`KEEPALIVE falhou: ${e.message} — o terminal passaria a decidir sozinho`));
  bater();
  keepalive = setInterval(bater, segundos * 1000);
  keepalive.unref();
}

const FOTO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(256), Buffer.from([0xff, 0xd9])]);

function corpoEventos(eventos) {
  const json = JSON.stringify({ Events: eventos.map((Data, Index) => ({ Action: "Pulse", Code: "AccessControl", Data, Index, PhysicalAddress: "c0:39:5a:00:00:01" })), Time: "" });
  return Buffer.concat([
    Buffer.from(`--myboundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}\r\n`),
    Buffer.from(`--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${FOTO.length}\r\n\r\n`),
    FOTO,
    Buffer.from("\r\n--myboundary--\r\n"),
  ]);
}

async function tentar(dados, rotulo) {
  if (!modoOnline) return log("O Gateway ainda não pôs o terminal no Modo Online.");
  const t0 = Date.now();
  try {
    const r = await chamarServidor("POST", "/notification", corpoEventos([dados]), "multipart/mixed; boundary=myboundary");
    const j = JSON.parse(r.texto);
    log(`${rotulo} → ${j.auth === "true" ? "LIBERADO" : "NEGADO"} em ${Date.now() - t0} ms  (display: "${j.message}")`);
  } catch (e) {
    log(`${rotulo} → sem resposta do Gateway (${e.message}): o terminal decidiria sozinho`);
  }
}

const agora = () => Math.floor(Date.now() / 1000);

async function executar(linha) {
  const [cmd, valor] = linha.trim().split(/\s+/);
  if (!cmd) return;
  if (cmd === "r") return tentar({ UserID: valor, CardNo: "", Method: 15, Type: "Entry", Status: 0, UTC: agora(), Door: 0 }, `ROSTO do usuário ${valor}`);
  if (cmd === "b") return tentar({ UserID: valor, CardNo: "", Method: 6, Type: "Entry", Status: 0, UTC: agora(), Door: 0 }, `DIGITAL do usuário ${valor}`);
  if (cmd === "c") return tentar({ UserID: "", CardNo: valor, Method: 1, Type: "Entry", Status: 0, UTC: agora(), Door: 0 }, `CARTÃO ${valor}`);
  if (cmd === "s") return tentar({ UserID: valor, CardNo: "", Method: 15, Type: "Exit", Status: 0, UTC: agora(), Door: 0 }, `SAÍDA do usuário ${valor}`);
  if (cmd === "h") {
    const r = await chamarServidor("POST", "/notification", corpoEventos([
      { UserID: valor, Method: 15, Type: "Entry", Status: 1, UTC: agora() - 3600, Door: 0 },
      { UserID: valor, Method: 15, Type: "Exit", Status: 1, UTC: agora() - 1800, Door: 0 },
    ]), "multipart/mixed; boundary=myboundary").catch((e) => ({ texto: `{"erro":"${e.message}"}` }));
    return log(`HISTÓRICO enviado (entrada de 1 h atrás) → ${r.texto}`);
  }
  if (cmd === "u") return log(`USUÁRIOS: ${[...usuarios.values()].map((u) => `${u.UserID}${rotulo(u)}${rostos.has(String(u.UserID)) ? " +rosto" : ""}`).join(", ") || "nenhum"}`);
  if (cmd === "sair") process.exit(0);
  log(`Comando desconhecido: ${cmd}`);
}

if (args.ler) {
  const espera = () => new Promise((r) => setTimeout(r, 400));
  (async () => {
    while (!modoOnline) await espera();
    for (const c of String(args.ler).split(",")) {
      await executar(c);
      await espera();
    }
    if (args.sair) process.exit(0);
  })();
}
readline.createInterface({ input: process.stdin }).on("line", (l) => void executar(l));

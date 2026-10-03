#!/usr/bin/env node
/**
 * Emulador da placa Toletus LiteNet3 — faz o papel da catraca para um
 * Gateway rodando, sem hardware.
 *
 * Na LiteNet3 quem disca é a placa: o Gateway manda o endereço dele por
 * UDP (porta 7878 da placa) e a placa conecta por WebSocket, com os
 * cabeçalhos `x-api-key` e `Serial`. Este emulador escuta o UDP, responde
 * à descoberta, disca quando recebe o endereço e manda as leituras que
 * você digitar, mostrando o que o Gateway respondeu.
 *
 * Escrito a partir do pacote oficial da Toletus
 * (github.com/Toletus/LiteNet3-IntegrationPackage), sem importar o código
 * do Gateway: um erro de leitura do pacote não aparece igual dos dois lados.
 *
 * O que ele NÃO substitui: o número que um cartão de verdade produz, o
 * formato exato do aviso de passagem, o que a placa faz sem servidor e o
 * sentido de giro da catraca montada. Isso é bancada.
 *
 * Uso:
 *   node scripts/emulador-litenet3.mjs                          (UDP 7878, interativo)
 *   node scripts/emulador-litenet3.mjs --udp 7978 --serial 00000042 --giro desiste
 *   node scripts/emulador-litenet3.mjs --ler "c 3954862189, t 52998224725" --sair
 *
 * No config.json do Gateway:
 *   "modelo_catraca": "toletus",
 *   "toletus_equipamentos": [{ "nome": "Catraca", "ip": "127.0.0.1", "placa": "litenet3" }]
 *
 * Comandos: c <número> (cartão), q <número> (código de barras),
 *   t <dígitos> (teclado; 11 dígitos = CPF), x (digital: manda um pedaço
 *   da imagem), p (passagem sem liberação), g passa|desiste|nada, sair.
 */

import dgram from "node:dgram";
import readline from "node:readline";
import { WebSocket } from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const portaUdp = Number(args.udp ?? 7878);
const serial = String(args.serial ?? "00000042");
let giro = args.giro ?? "passa";
const esperaMs = Number(args.espera ?? 1500);
const CHAVE = "12345-abcde-67890-fghij";

let ws = null;
let uri = null;
let entradas = 0;
let saidas = 0;
let roteiroIniciado = false;

const udp = dgram.createSocket("udp4");

function enviar(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("  (a placa ainda não está conectada ao Gateway)");
    return;
  }
  ws.send(JSON.stringify(msg));
}

function notificar(tipo, dados = {}) {
  enviar({ notification: tipo, data: { serial, ...dados } });
}

function discar() {
  if (!uri) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  console.log(`Discando para ${uri}…`);
  ws = new WebSocket(uri, { headers: { "x-api-key": CHAVE, Serial: serial } });
  ws.on("open", () => {
    console.log("Conectada ao Gateway.");
    if (args.ler && !roteiroIniciado) {
      roteiroIniciado = true;
      void lerRoteiro(args.ler);
    }
  });
  ws.on("unexpected-response", (_req, res) => console.log(`Gateway recusou a conexão (HTTP ${res.statusCode}).`));
  ws.on("message", (dados) => tratar(JSON.parse(dados.toString())));
  ws.on("close", () => console.log("Desconectada do Gateway."));
  ws.on("error", (err) => console.log(`Erro na conexão: ${err.message}`));
}

function aposLiberar(release, topo) {
  const sentido = release === "Out" ? "saída" : release === "Both" ? "os dois sentidos" : "entrada";
  console.log(`← LIBEROU ${sentido}: "${topo}"`);
  enviar({ action: "litenet3", result: "ok" });
  if (giro === "nada") return;
  setTimeout(() => {
    if (giro === "desiste") {
      console.log("→ tempo esgotado sem passagem (desistiu)");
      notificar("timeout", { release, time: 10000 });
    } else if (release === "Out") {
      console.log(`→ passagem de saída (${++saidas})`);
      notificar("passage", { in: entradas, out: saidas });
    } else {
      console.log(`→ passagem de entrada (${++entradas})`);
      notificar("passage", { in: entradas, out: saidas });
    }
  }, esperaMs);
}

function tratar(msg) {
  if (msg.fetch === "factory") {
    return enviar({ fetch: "factory", data: { serial, factory: false, firmware: "V1.0.1.2", hardware: "V1.0.0" } });
  }
  if (msg.action === "litenet3" && msg.data?.release) return aposLiberar(msg.data.release, msg.data.topRow);
  if (msg.action === "display") {
    enviar({ action: "display", result: "ok" });
    return console.log(`← DISPLAY: "${msg.data?.topRow ?? ""}" por ${msg.data?.time ?? "?"} ms`);
  }
  if (msg.action === "buzzer") {
    enviar({ action: "buzzer", result: "ok" });
    return console.log(`← TOQUE: ${msg.data?.play ?? msg.data?.cmd ?? ""}`);
  }
  console.log(`← ${JSON.stringify(msg)} (não emulado)`);
}

udp.on("message", (bruto, origem) => {
  let msg;
  try {
    msg = JSON.parse(bruto.toString());
  } catch {
    return;
  }
  if (msg.fetch === "discovery") {
    const resposta = { fetch: "discovery", data: { serial, id: 1, alias: "Emulador", serverUri: uri, ip: "127.0.0.1", connected: !!ws, firmware: "V1.0.1.2", hardware: "V1.0.0" } };
    udp.send(JSON.stringify(resposta), origem.port, origem.address);
  } else if (msg.update === "server" && msg.data?.serial === serial) {
    if (uri !== msg.data.uri) console.log(`Endereço do Gateway recebido por UDP: ${msg.data.uri}`);
    uri = msg.data.uri;
    udp.send(JSON.stringify({ update: "server", result: "ok" }), origem.port, origem.address);
    discar();
  }
});

function executar(linha) {
  const [cmd, valor = ""] = linha.trim().split(/\s+/, 2);
  switch (cmd) {
    case "c":
      console.log(`→ cartão ${valor}`);
      return notificar("rfid", { code: valor });
    case "q":
      console.log(`→ código de barras ${valor}`);
      return notificar("barcode", { code: valor });
    case "t":
      console.log(`→ teclado ${valor.length === 11 ? "(CPF)" : valor}`);
      return notificar("keypad", { code: valor });
    case "x":
      console.log("→ digital: um pedaço da imagem do dedo");
      return notificar("biometrics", { id: 1, len: 8, init: true, package: "AAECAwQFBgc=", finally: false, lenTotal: 16 });
    case "p":
      console.log(`→ passagem de saída sem liberação (${++saidas})`);
      return notificar("passage", { in: entradas, out: saidas });
    case "g":
      if (["passa", "desiste", "nada"].includes(valor)) giro = valor;
      return console.log(`Giro depois da liberação: ${giro}.`);
    case "sair":
      process.exit(0);
    case "":
      return;
    default:
      console.log("Comandos: c <cartão>, q <código>, t <dígitos>, x, p, g passa|desiste|nada, sair");
  }
}

async function lerRoteiro(roteiro) {
  const passos = roteiro.split(",").map((s) => s.trim()).filter(Boolean);
  for (const passo of passos) {
    await new Promise((r) => setTimeout(r, 3000));
    executar(passo);
  }
  if (args.sair) setTimeout(() => process.exit(0), esperaMs + 3000);
}

udp.bind(portaUdp, "0.0.0.0", () => {
  console.log(`Placa Toletus LiteNet3 emulada (serial ${serial}), UDP ${portaUdp}. Esperando o anúncio do Gateway…`);
  console.log(`Giro depois da liberação: ${giro} (em ${esperaMs} ms).`);
});

readline.createInterface({ input: process.stdin }).on("line", executar);

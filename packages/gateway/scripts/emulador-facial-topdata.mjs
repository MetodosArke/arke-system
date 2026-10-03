#!/usr/bin/env node
/**
 * Emulador do leitor facial da Topdata (leitor F4/T4, catracas da linha
 * Easy) — faz o papel do equipamento para um Gateway rodando, sem hardware.
 *
 * O leitor é quem disca: conecta por WebSocket no servidor do menu
 * (porta 7792), apresenta-se com o `reg` e manda cada rosto reconhecido
 * como `sendlog`, esperando a resposta com `access`. Também guarda os
 * usuários que o Gateway cadastra (`setuserinfo`) e apaga (`deleteuser`).
 * Com --http, serve a API HTTP do leitor (abertura remota).
 *
 * Escrito a partir da página "Comandos do Leitor Facial" do portal de
 * integradores da Topdata, sem importar o código do Gateway.
 *
 * O que ele NÃO substitui: o reconhecimento do rosto, o tempo que o leitor
 * espera a resposta, a ligação com a catraca e o que o firmware faz com o
 * histórico ao reconectar. Isso é bancada (Kit Integrador da Topdata).
 *
 * Uso:
 *   node scripts/emulador-facial-topdata.mjs                      (127.0.0.1:7792, interativo)
 *   node scripts/emulador-facial-topdata.mjs --servidor 192.168.0.10 --sn AYSH01 --http 8080 --senha 1234
 *   node scripts/emulador-facial-topdata.mjs --ler "r 1, d, r 2" --sair
 *
 * No config.json do Gateway:
 *   "modelo_catraca": "topdata_facial",
 *   "topdata_faciais": [{ "nome": "Catraca", "ip": "127.0.0.1", "sn": "AYSH01090913" }]
 *
 * Comandos: r <número> (rosto do usuário cadastrado com esse número),
 *   d (rosto desconhecido), h (manda histórico guardado), u (lista os
 *   usuários do leitor), sair.
 */

import http from "node:http";
import readline from "node:readline";
import { WebSocket } from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const servidor = args.servidor ?? "127.0.0.1";
const porta = Number(args.porta ?? 7792);
const sn = String(args.sn ?? "AYSH01090913");
const senha = String(args.senha ?? "1234");
const usuarios = new Map();
let ws = null;
let roteiroIniciado = false;

const agora = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

function enviar(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("  (o leitor ainda não está conectado ao Gateway)");
    return;
  }
  ws.send(JSON.stringify(msg));
}

function conectar() {
  ws = new WebSocket(`ws://${servidor}:${porta}/pub/chat`);
  ws.on("open", () => {
    console.log(`Conectado a ${servidor}:${porta}. Mandando o reg…`);
    enviar({
      cmd: "reg",
      sn,
      devinfo: { modelname: "AiFace", usersize: 15000, facesize: 5000, useduser: usuarios.size, usedface: 0, firmware: "ai518_fp26v_v1.27", time: agora(), mac: "00-00-00-00-00-00" },
    });
  });
  ws.on("message", (dados) => tratar(JSON.parse(dados.toString())));
  ws.on("close", () => {
    console.log("Desconectado. Tentando de novo em 3 s…");
    setTimeout(conectar, 3000);
  });
  ws.on("error", () => {});
}

function tratar(msg) {
  if (msg.ret === "reg") {
    if (msg.result) {
      console.log(`← reg aceito (hora do servidor ${msg.cloudtime})`);
      if (args.ler && !roteiroIniciado) {
        roteiroIniciado = true;
        void lerRoteiro(args.ler);
      }
    } else console.log("← reg RECUSADO: este leitor não está no config.json do Gateway");
    return;
  }
  if (msg.ret === "sendlog") {
    if (msg.access === true) return console.log(`← LIBEROU: "${msg.message}"`);
    if (msg.access === false && msg.message) return console.log(`← NEGOU: "${msg.message}"`);
    return console.log("← recebido (sem decisão)");
  }
  if (msg.ret === "senduser") return console.log("← cadastro no menu respondido");
  switch (msg.cmd) {
    case "setdevinfo":
      console.log(`← configuração: server_verify=${msg.server_verify} (${msg.server_verify === 1 ? "só online" : msg.server_verify === 0 ? "só offline" : "automático"}), stranger_lock=${msg.stranger_lock}`);
      return enviar({ ret: "setdevinfo", result: true });
    case "setuserinfo":
      usuarios.set(Number(msg.enrollid), msg);
      console.log(`← cadastrou o usuário ${msg.enrollid}${msg.card ? ` (cartão ${msg.card})` : ""}`);
      return enviar({ ret: "setuserinfo", sn, result: true });
    case "deleteuser": {
      const existia = usuarios.delete(Number(msg.enrollid));
      console.log(`← apagou o usuário ${msg.enrollid}${existia ? "" : " (já não existia)"}`);
      return enviar(existia ? { ret: "deleteuser", result: true } : { ret: "deleteuser", result: false, reason: 1, msg: "can not find the user" });
    }
    default:
      console.log(`← ${JSON.stringify(msg)} (não emulado)`);
  }
}

function executar(linha) {
  const [cmd, valor = ""] = linha.trim().split(/\s+/, 2);
  switch (cmd) {
    case "r": {
      const id = Number(valor);
      if (!usuarios.has(id)) console.log(`  (o usuário ${id} não está cadastrado neste leitor; o leitor de verdade não o reconheceria)`);
      console.log(`→ rosto do usuário ${id}`);
      return enviar({ cmd: "sendlog", sn, count: 1, logindex: 0, record: [{ enrollid: id, name: "Aluno", time: agora(), mode: 8, inout: 0, event: 0 }] });
    }
    case "d":
      console.log("→ rosto desconhecido (com a foto, como o leitor manda)");
      return enviar({
        cmd: "sendlog",
        sn,
        count: 1,
        logindex: 1,
        record: [{ enrollid: 99999999, name: "", time: agora(), mode: 1, inout: 0, event: 2, image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD" }],
      });
    case "h":
      console.log("→ histórico guardado (2 registros antigos)");
      return enviar({
        cmd: "sendlog",
        sn,
        count: 2,
        logindex: 2,
        record: [
          { enrollid: 1, name: "Aluno", time: "2026-01-10 08:00:00", mode: 8, inout: 0, event: 0 },
          { enrollid: 2, name: "Aluno", time: "2026-01-10 08:01:00", mode: 8, inout: 0, event: 0 },
        ],
      });
    case "u":
      return console.log(`Usuários no leitor: ${[...usuarios.keys()].join(", ") || "nenhum"}`);
    case "sair":
      process.exit(0);
    case "":
      return;
    default:
      console.log("Comandos: r <número>, d, h, u, sair");
  }
}

async function lerRoteiro(roteiro) {
  const passos = roteiro.split(",").map((s) => s.trim()).filter(Boolean);
  for (const passo of passos) {
    await new Promise((r) => setTimeout(r, 3000));
    executar(passo);
  }
  if (args.sair) setTimeout(() => process.exit(0), 3000);
}

if (args.http) {
  http
    .createServer((req, res) => {
      let corpo = "";
      req.on("data", (c) => (corpo += c));
      req.on("end", () => {
        const pedido = JSON.parse(corpo || "{}");
        res.setHeader("Content-Type", "application/json");
        if (pedido.password !== senha) {
          console.log(`← API HTTP "${pedido.cmd}" com senha errada`);
          return res.end(JSON.stringify({ ret: pedido.cmd, sn, result: false, reason: 2 }));
        }
        if (pedido.cmd === "opendoor") console.log(`← ABERTURA REMOTA: "${pedido.msg ?? ""}"`);
        else console.log(`← API HTTP "${pedido.cmd}" ${JSON.stringify({ ...pedido, password: undefined })}`);
        res.end(JSON.stringify({ ret: pedido.cmd, sn, result: true }));
      });
    })
    .listen(Number(args.http), "0.0.0.0", () => console.log(`API HTTP do leitor emulada na porta ${args.http} (senha ${senha}).`));
}

console.log(`Leitor facial Topdata emulado (sn ${sn}). Discando para ${servidor}:${porta}…`);
conectar();
readline.createInterface({ input: process.stdin }).on("line", executar);

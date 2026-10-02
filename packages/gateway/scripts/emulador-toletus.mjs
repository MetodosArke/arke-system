#!/usr/bin/env node
/**
 * Emulador da placa Toletus LiteNet2 — faz o papel da catraca para um
 * Gateway rodando, sem hardware.
 *
 * Na Toletus a placa é o servidor (porta 7878) e quem disca é o Gateway.
 * Então o emulador abre a porta e espera o Gateway conectar; depois manda
 * as leituras que você digitar, exatamente como a placa manda, e mostra o
 * que o Gateway respondeu: liberação ou negativa com a mensagem do display.
 *
 * Escrito direto do manual oficial (Manual de Comandos Toletus LiteNet2,
 * V1.0.22, github.com/Toletus/LiteNet2-ManuaisDeIntegracao), sem importar
 * o código do Gateway: um erro de leitura do manual não aparece igual dos
 * dois lados.
 *
 * O que ele NÃO substitui: o número que um cartão de verdade produz, o
 * leitor de digital, o tempo de liberação configurado na placa e o sentido
 * de giro da catraca montada. Isso é bancada.
 *
 * Uso:
 *   node scripts/emulador-toletus.mjs                       (porta 7878, interativo)
 *   node scripts/emulador-toletus.mjs --porta 7979 --giro desiste
 *   node scripts/emulador-toletus.mjs --ler "c 3954862189, t 52998224725" --sair
 *
 * Com o Gateway, aponte o config.json para este computador:
 *   "modelo_catraca": "toletus", "catraca_ip": "127.0.0.1"
 *
 * Comandos no terminal:
 *   c <número>   aproxima um cartão (RFID)
 *   q <número>   lê um código de barras
 *   t <dígitos>  digita no teclado (11 dígitos = CPF)
 *   b <número>   digital reconhecida pelo leitor (número do usuário)
 *   x            digital não cadastrada
 *   p            passagem sem liberação (saída livre)
 *   g <modo>     o que acontece depois da próxima liberação: passa, desiste ou nada
 *   sair
 *
 * Opções: --porta 7878, --giro passa|desiste|nada (padrão passa),
 *         --espera 1500 (ms entre a liberação e o aviso),
 *         --ler "c 123, t 456" (leituras automáticas, uma a cada 3 s),
 *         --sair (encerra depois das leituras automáticas)
 */

import net from "node:net";
import readline from "node:readline";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const porta = Number(args.porta ?? 7878);
let giro = args.giro ?? "passa";
const esperaMs = Number(args.espera ?? 1500);

const PREFIXO = 0x53;
const SUFIXO = 0xc3;
const C = {
  LIBERA_ENTRADA: 0x0001,
  LIBERA_SAIDA: 0x0002,
  MENSAGEM_TEMPORARIA: 0x0004,
  NOTIFICA_USUARIO: 0x0005,
  LIBERA_DOIS_SENTIDOS: 0x0006,
  CONSULTA_ID: 0x0103,
  CONSULTA_FIRMWARE: 0x010c,
  CONSULTA_SERIAL: 0x010d,
  ID_RFID: 0x0301,
  ID_CODIGO_BARRAS: 0x0302,
  ID_TECLADO: 0x0303,
  PASSAGEM: 0x0304,
  TEMPO_ESGOTADO: 0x0305,
  ID_BIOMETRIA: 0x0306,
  BIOMETRIA_NAO_CADASTRADA: 0x0307,
};

function pacote(comando, dados = Buffer.alloc(16)) {
  const p = Buffer.alloc(20);
  p[0] = PREFIXO;
  p.writeUInt16LE(comando, 1);
  dados.copy(p, 3, 0, 16);
  p[19] = SUFIXO;
  return p;
}

const texto = (s) => {
  const d = Buffer.alloc(16);
  d.write(String(s).slice(0, 16), "ascii");
  return d;
};
const lerTexto = (d) => {
  const fim = d.indexOf(0);
  return d.subarray(0, fim === -1 ? 16 : fim).toString("ascii");
};

let socket = null;
let passagens = 0;
let ultimaMensagem = "";

function enviar(p) {
  if (!socket) {
    console.log("  (o Gateway ainda não conectou)");
    return;
  }
  socket.write(p);
}

function aposLiberar(sentido, mensagem) {
  console.log(`← LIBEROU ${sentido}: "${mensagem}"`);
  if (giro === "nada") return;
  setTimeout(() => {
    if (giro === "desiste") {
      console.log("→ tempo esgotado sem passagem (desistiu)");
      enviar(pacote(C.TEMPO_ESGOTADO));
    } else {
      const d = Buffer.alloc(16);
      d[0] = sentido === "saída" ? 2 : 1;
      d.writeUInt32LE(++passagens, 1);
      console.log(`→ passagem de ${sentido === "saída" ? "saída" : "entrada"} (${passagens})`);
      enviar(pacote(C.PASSAGEM, d));
    }
  }, esperaMs);
}

function tratar(comando, dados) {
  switch (comando) {
    case C.CONSULTA_ID: {
      const d = Buffer.alloc(16);
      d.writeUInt16LE(1, 0);
      return enviar(pacote(comando, d));
    }
    case C.CONSULTA_FIRMWARE:
      return enviar(pacote(comando, Buffer.from([2, 1, 1, 0, ...new Array(12).fill(0)])));
    case C.CONSULTA_SERIAL: {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(999001, 0);
      return enviar(pacote(comando, d));
    }
    case C.LIBERA_ENTRADA:
      return aposLiberar("entrada", lerTexto(dados));
    case C.LIBERA_SAIDA:
      return aposLiberar("saída", lerTexto(dados));
    case C.LIBERA_DOIS_SENTIDOS:
      return aposLiberar("nos dois sentidos", lerTexto(dados));
    case C.MENSAGEM_TEMPORARIA:
      ultimaMensagem = lerTexto(dados);
      return;
    case C.NOTIFICA_USUARIO:
      return console.log(`← NEGOU: "${ultimaMensagem}" (toque ${dados[2]}, cor ${dados[3]})`);
    default:
      return console.log(`← comando 0x${comando.toString(16).padStart(4, "0")} (não emulado)`);
  }
}

const servidor = net.createServer((s) => {
  if (socket) {
    // A placa de verdade aceita um computador por vez.
    console.log("Outra conexão recusada: já há um Gateway conectado.");
    s.destroy();
    return;
  }
  socket = s;
  console.log(`Gateway conectado de ${s.remoteAddress}.`);
  let resto = Buffer.alloc(0);
  s.on("data", (pedaco) => {
    resto = Buffer.concat([resto, pedaco]);
    while (resto.length >= 20) {
      if (resto[0] !== PREFIXO || resto[19] !== SUFIXO) {
        resto = resto.subarray(1);
        continue;
      }
      tratar(resto.readUInt16LE(1), resto.subarray(3, 19));
      resto = resto.subarray(20);
    }
  });
  s.on("close", () => {
    console.log("Gateway desconectou.");
    socket = null;
  });
  s.on("error", () => {});
  if (args.ler) void lerRoteiro(args.ler);
});

function executar(linha) {
  const [cmd, valor = ""] = linha.trim().split(/\s+/, 2);
  switch (cmd) {
    case "c":
      console.log(`→ cartão ${valor}`);
      return enviar(pacote(C.ID_RFID, texto(valor)));
    case "q":
      console.log(`→ código de barras ${valor}`);
      return enviar(pacote(C.ID_CODIGO_BARRAS, texto(valor)));
    case "t":
      console.log(`→ teclado ${valor.length === 11 ? "(CPF)" : valor}`);
      return enviar(pacote(C.ID_TECLADO, texto(valor)));
    case "b": {
      const d = Buffer.alloc(16);
      d.writeUInt16LE(Number(valor) & 0xffff, 0);
      console.log(`→ digital do usuário ${valor}`);
      return enviar(pacote(C.ID_BIOMETRIA, d));
    }
    case "x":
      console.log("→ digital não cadastrada");
      return enviar(pacote(C.BIOMETRIA_NAO_CADASTRADA));
    case "p": {
      const d = Buffer.alloc(16);
      d[0] = 2;
      d.writeUInt32LE(++passagens, 1);
      console.log("→ passagem de saída sem liberação");
      return enviar(pacote(C.PASSAGEM, d));
    }
    case "g":
      if (["passa", "desiste", "nada"].includes(valor)) giro = valor;
      return console.log(`Giro depois da liberação: ${giro}.`);
    case "sair":
      process.exit(0);
    case "":
      return;
    default:
      console.log("Comandos: c <cartão>, q <código>, t <dígitos>, b <usuário>, x, p, g passa|desiste|nada, sair");
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

servidor.listen(porta, "0.0.0.0", () => {
  console.log(`Placa Toletus LiteNet2 emulada na porta ${porta}. Esperando o Gateway conectar…`);
  console.log(`Giro depois da liberação: ${giro} (em ${esperaMs} ms).`);
});

readline.createInterface({ input: process.stdin }).on("line", executar);

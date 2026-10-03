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
 * Com --leitor, faz também o papel do leitor de digital SM25 da placa, na
 * porta 7879: o Gateway cadastra, apaga e copia digitais como faria no
 * equipamento. O "dedo" é um número: o mesmo dedo gera sempre a mesma
 * digital, e é assim que o leitor percebe a digital repetida. Escrito do
 * manual do fabricante do leitor (CAMA-SM25 User's Manual, publicado pela
 * Toletus em github.com/Toletus/LiteNet2-ExemploIntegracao).
 *
 * O que ele NÃO substitui: o número que um cartão de verdade produz, a
 * leitura de um dedo de verdade, o tempo de liberação configurado na placa e
 * o sentido de giro da catraca montada. Isso é bancada.
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
 *   d <dedo>     (com --leitor) põe o dedo no leitor; "d -" tira
 *   i            (com --leitor) a placa reconhece o dedo posto: manda o número dele, ou "não cadastrada"
 *   l            (com --leitor) lista as digitais guardadas
 *   p            passagem sem liberação (saída livre)
 *   g <modo>     o que acontece depois da próxima liberação: passa, desiste ou nada
 *   sair
 *
 * Opções: --porta 7878, --giro passa|desiste|nada (padrão passa),
 *         --espera 1500 (ms entre a liberação e o aviso),
 *         --ler "c 123, t 456" (leituras automáticas, uma a cada 3 s),
 *         --sair (encerra depois das leituras automáticas),
 *         --leitor (leitor de digital na 7879), --porta-leitor 7879,
 *         --dedo 1 (o dedo que começa no leitor; "-" para nenhum)
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
      // Vermelho é negativa; amarelo e verde são o passo a passo do cadastro da digital.
      return console.log(`← ${dados[3] === 1 ? "NEGOU" : "AVISO"}: "${ultimaMensagem}" (toque ${dados[2]}, cor ${dados[3]})`);
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
    case "d":
    case "i":
    case "l":
      return comandoDoLeitor(cmd, valor);
    case "g":
      if (["passa", "desiste", "nada"].includes(valor)) giro = valor;
      return console.log(`Giro depois da liberação: ${giro}.`);
    case "sair":
      process.exit(0);
    case "":
      return;
    default:
      console.log("Comandos: c <cartão>, q <código>, t <dígitos>, b <usuário>, x, p, g passa|desiste|nada, d <dedo>, i, l, sair");
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

// --- Leitor de digital SM25 (porta 7879), do manual da CAMA ---
//
// Pacote de comando (24 bytes): 55 AA | cmd | len | parâmetro (16) | soma.
// Resposta (24 bytes): AA 55 | cmd | len | ret | dados (14) | soma.
// Pacotes de dados: 5A A5 (do computador) e A5 5A (do leitor), com len = n.
// Números em little-endian; a soma é a palavra baixa da soma dos bytes.

const SM = {
  CADASTRAR: 0x0103,
  APAGAR: 0x0105,
  SITUACAO: 0x0108,
  LER: 0x010a,
  GRAVAR: 0x010b,
  DEFINIR_TEMPO: 0x010e,
  TEMPO: 0x010f,
  CANCELAR: 0x0130,
  TESTAR: 0x0150,
  INCORRETO: 0x0160,
};
const ERR = { VAZIO: 0x13, OCUPADO: 0x14, REPETIDA: 0x19, CANCELADO: 0x41, NUMERO_INVALIDO: 0x60, PARAMETRO: 0x70 };
const CAPACIDADE = 3000;
const digitais = new Map(); // número → registro de 498 bytes
let dedo = args.dedo === "-" ? null : Number(args.dedo ?? 1);
let tempoDoDedo = 5;

const somar = (b, ate) => {
  let s = 0;
  for (let i = 0; i < ate; i++) s += b[i];
  return s & 0xffff;
};

function registroDoDedo(n) {
  const r = Buffer.alloc(498);
  for (let i = 0; i < 496; i++) r[i] = (n * 31 + i * 7) & 0xff;
  r.writeUInt16LE(somar(r, 496), 496);
  return r;
}

function responder(s, comando, ret, ...valores) {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(0x55aa, 0);
  b.writeUInt16LE(comando, 2);
  b.writeUInt16LE(2 + Math.max(2, valores.length * 2), 4);
  b.writeUInt16LE(ret, 6);
  valores.forEach((v, i) => b.writeUInt16LE(v & 0xffff, 8 + i * 2));
  b.writeUInt16LE(somar(b, 22), 22);
  if (!s.destroyed) s.write(b);
}

function responderDados(s, comando, ret, dados) {
  const n = 2 + dados.length;
  const b = Buffer.alloc(n + 8);
  b.writeUInt16LE(0x5aa5, 0);
  b.writeUInt16LE(comando, 2);
  b.writeUInt16LE(n, 4);
  b.writeUInt16LE(ret, 6);
  dados.copy(b, 8);
  b.writeUInt16LE(somar(b, b.length - 2), b.length - 2);
  if (!s.destroyed) s.write(b);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function conversaComLeitor(s) {
  let resto = Buffer.alloc(0);
  let cadastro = null;
  let gravacao = false;

  async function cadastrar(numero) {
    if (numero < 1 || numero > CAPACIDADE) return responder(s, SM.CADASTRAR, 1, ERR.NUMERO_INVALIDO);
    if (digitais.has(numero)) return responder(s, SM.CADASTRAR, 1, ERR.OCUPADO);
    cadastro = { cancelado: false };
    for (const [toque, vez] of [
      [0xfff1, 1],
      [0xfff2, 2],
      [0xfff3, 3],
    ]) {
      responder(s, SM.CADASTRAR, 0, toque);
      console.log(`  [leitor] cadastro do número ${numero}: ponha o dedo (${vez}/3)`);
      while (dedo === null) {
        await esperar(50);
        if (cadastro.cancelado || s.destroyed) return;
      }
      await esperar(300);
      if (cadastro.cancelado || s.destroyed) return;
      responder(s, SM.CADASTRAR, 0, 0xfff4);
    }
    const registro = registroDoDedo(dedo);
    for (const [outro, r] of digitais) {
      if (r.equals(registro)) {
        console.log(`  [leitor] o dedo ${dedo} já está no número ${outro}: digital repetida`);
        cadastro = null;
        return responder(s, SM.CADASTRAR, 1, ERR.REPETIDA, outro);
      }
    }
    digitais.set(numero, registro);
    cadastro = null;
    console.log(`  [leitor] digital do dedo ${dedo} guardada no número ${numero}`);
    responder(s, SM.CADASTRAR, 0, numero, 0);
  }

  function tratarComando(comando, len, param) {
    const v = len >= 2 ? param.readUInt16LE(0) : 0;
    switch (comando) {
      case SM.TESTAR:
        return responder(s, comando, 0);
      case SM.TEMPO:
        return responder(s, comando, 0, tempoDoDedo);
      case SM.DEFINIR_TEMPO:
        tempoDoDedo = v;
        console.log(`  [leitor] tempo do dedo: ${v} s`);
        return responder(s, comando, 0, v);
      case SM.SITUACAO:
        if (v < 1 || v > CAPACIDADE) return responder(s, comando, 1, ERR.NUMERO_INVALIDO);
        return responder(s, comando, 0, digitais.has(v) ? 1 : 0);
      case SM.APAGAR:
        if (v < 1 || v > CAPACIDADE) return responder(s, comando, 1, ERR.NUMERO_INVALIDO);
        if (!digitais.delete(v)) return responder(s, comando, 1, ERR.VAZIO);
        console.log(`  [leitor] digital do número ${v} apagada`);
        return responder(s, comando, 0, v);
      case SM.LER: {
        const r = digitais.get(v);
        if (!r) return responder(s, comando, 1, ERR.VAZIO);
        responder(s, comando, 0, 500);
        const d = Buffer.alloc(500);
        d.writeUInt16LE(v, 0);
        r.copy(d, 2);
        return responderDados(s, comando, 0, d);
      }
      case SM.GRAVAR:
        if (v !== 498) return responder(s, comando, 1, ERR.PARAMETRO);
        gravacao = true;
        return responder(s, comando, 0, 0);
      case SM.CANCELAR:
        if (cadastro && !cadastro.cancelado) {
          cadastro.cancelado = true;
          console.log("  [leitor] cadastro cancelado");
          responder(s, SM.CADASTRAR, 1, ERR.CANCELADO);
        }
        return responder(s, comando, 0);
      case SM.CADASTRAR:
        void cadastrar(v);
        return;
      default:
        return responder(s, SM.INCORRETO, 0);
    }
  }

  function gravar(b, n) {
    gravacao = false;
    const numero = b.readUInt16LE(6);
    const registro = Buffer.from(b.subarray(8, 8 + 498));
    const erro = (codigo) => {
      const d = Buffer.alloc(2);
      d.writeUInt16LE(codigo, 0);
      responderDados(s, SM.GRAVAR, 1, d);
    };
    if (n !== 500) return erro(ERR.PARAMETRO);
    if (numero < 1 || numero > CAPACIDADE) return erro(ERR.NUMERO_INVALIDO);
    if (somar(registro, 496) !== registro.readUInt16LE(496)) return erro(ERR.PARAMETRO);
    digitais.set(numero, registro);
    console.log(`  [leitor] digital copiada para o número ${numero}`);
    const d = Buffer.alloc(2);
    d.writeUInt16LE(numero, 0);
    responderDados(s, SM.GRAVAR, 0, d);
  }

  s.on("data", (pedaco) => {
    resto = Buffer.concat([resto, pedaco]);
    while (resto.length >= 2) {
      const prefixo = resto.readUInt16LE(0);
      if (prefixo === 0xaa55) {
        if (resto.length < 24) break;
        const b = resto.subarray(0, 24);
        if (somar(b, 22) !== b.readUInt16LE(22)) {
          resto = resto.subarray(1);
          continue;
        }
        tratarComando(b.readUInt16LE(2), b.readUInt16LE(4), b.subarray(6, 22));
        resto = resto.subarray(24);
      } else if (prefixo === 0xa55a) {
        if (resto.length < 6) break;
        const n = resto.readUInt16LE(4);
        if (resto.length < n + 8) break;
        const b = resto.subarray(0, n + 8);
        if (gravacao && b.readUInt16LE(2) === SM.GRAVAR && somar(b, n + 6) === b.readUInt16LE(n + 6)) gravar(b, n);
        resto = resto.subarray(n + 8);
      } else {
        resto = resto.subarray(1);
      }
    }
  });
}

if (args.leitor) {
  const portaLeitor = Number(args["porta-leitor"] ?? 7879);
  net
    .createServer((s) => {
      console.log("  [leitor] Gateway conectou no leitor de digital.");
      s.on("error", () => {});
      conversaComLeitor(s);
    })
    .listen(portaLeitor, "0.0.0.0", () => {
      console.log(`Leitor de digital SM25 emulado na porta ${portaLeitor}. Dedo no leitor: ${dedo ?? "nenhum"}.`);
    });
}

function comandoDoLeitor(cmd, valor) {
  if (!args.leitor) return console.log("Rode com --leitor para emular o leitor de digital.");
  if (cmd === "d") {
    dedo = valor === "-" || valor === "" ? null : Number(valor);
    return console.log(dedo === null ? "Dedo fora do leitor." : `Dedo ${dedo} no leitor.`);
  }
  if (cmd === "l") {
    return console.log(digitais.size ? [...digitais.keys()].map((n) => `número ${n}`).join(", ") : "Nenhuma digital guardada.");
  }
  // i: a placa reconhece o dedo posto, como faz com quem chega à catraca.
  const registro = dedo === null ? null : registroDoDedo(dedo);
  const achado = registro ? [...digitais].find(([, r]) => r.equals(registro)) : undefined;
  if (!achado) {
    console.log("→ digital não cadastrada");
    return enviar(pacote(C.BIOMETRIA_NAO_CADASTRADA));
  }
  const d = Buffer.alloc(16);
  d.writeUInt16LE(achado[0], 0);
  console.log(`→ digital reconhecida: número ${achado[0]}`);
  return enviar(pacote(C.ID_BIOMETRIA, d));
}

servidor.listen(porta, "0.0.0.0", () => {
  console.log(`Placa Toletus LiteNet2 emulada na porta ${porta}. Esperando o Gateway conectar…`);
  console.log(`Giro depois da liberação: ${giro} (em ${esperaMs} ms).`);
});

readline.createInterface({ input: process.stdin }).on("line", executar);

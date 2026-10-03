/**
 * Protocolo dos terminais de acesso da Intelbras (linha Bio-T), no Modo
 * Online. Transcrito da documentação de integração (portal da Intelbras,
 * coleção "Controle de Acesso - Bio-T - Intelbras", e o site antigo da API)
 * e dos exemplos oficiais em github.com/integracaoca, conferidos em
 * 02/10/2026.
 *
 * Quem disca é o terminal: a cada tentativa de acesso ele faz
 * `POST /notification` no Gateway, com o evento em JSON e a foto da pessoa
 * num corpo multipart, e espera `{ message, code, auth }`; e de tempos em
 * tempos faz `GET /keepalive`. Para administrar o terminal (cadastro,
 * remoção, abertura) o Gateway chama a API CGI dele, com autenticação Digest.
 *
 * Este módulo é só tradução, sem rede.
 */

import { createHash, randomBytes } from "node:crypto";
import { mensagemDoDisplay } from "../toletus/protocolo";

export const PORTA_HTTP_INTELBRAS = 80;

/** Registro de acesso de mais de 5 minutos atrás é histórico guardado sem servidor, não pedido de agora. */
export const JANELA_TEMPO_REAL_MS = 5 * 60_000;

type Objeto = Record<string, unknown>;

export interface EventoIntelbras {
  code: string;
  action: string | null;
  data: Objeto;
  mac: string | null;
}

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function eventosDoJson(bruto: string): EventoIntelbras[] {
  let j: unknown;
  try {
    j = JSON.parse(bruto);
  } catch {
    return [];
  }
  const lista = (j as { Events?: unknown })?.Events;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((e): e is Objeto => !!e && typeof e === "object")
    .map((e) => ({
      code: String(e.Code ?? ""),
      action: texto(e.Action),
      data: (e.Data && typeof e.Data === "object" ? e.Data : {}) as Objeto,
      mac: texto(e.PhysicalAddress),
    }));
}

/**
 * Os eventos de um `POST /notification`.
 *
 * FOTO. O terminal manda, junto com o evento, a foto da pessoa no momento
 * do acesso (parte `image/jpeg`). Ela é descartada aqui, na leitura: não
 * vira texto, não entra no evento, não vai para log nem para a nuvem. A
 * decisão não precisa dela, e rosto de quem está na frente da catraca não
 * tem por que sair do terminal.
 *
 * O corpo é `multipart/mixed` com a fronteira `myboundary` (a do exemplo
 * oficial; a do cabeçalho vale quando vier). Aceita CRLF e LF. Corpo que
 * já é o JSON (firmware que mande assim) também serve.
 */
export function extrairEventos(corpo: Buffer, contentType?: string | null): EventoIntelbras[] {
  const fronteira = /boundary="?([^";]+)"?/i.exec(contentType ?? "")?.[1] ?? "myboundary";
  const marca = Buffer.from(`--${fronteira}`);
  if (corpo.indexOf(marca) < 0) return eventosDoJson(corpo.toString("utf8"));

  const eventos: EventoIntelbras[] = [];
  let pos = corpo.indexOf(marca);
  while (pos >= 0) {
    const inicio = pos + marca.length;
    const prox = corpo.indexOf(marca, inicio);
    const parte = corpo.subarray(inicio, prox < 0 ? corpo.length : prox);
    pos = prox;
    // Fim dos cabeçalhos da parte: linha em branco, em CRLF ou LF.
    let fimCab = parte.indexOf("\r\n\r\n");
    let sep = 4;
    const fimLf = parte.indexOf("\n\n");
    if (fimCab < 0 || (fimLf >= 0 && fimLf < fimCab)) {
      fimCab = fimLf;
      sep = 2;
    }
    if (fimCab < 0) continue;
    // Só os cabeçalhos viram texto; o corpo de imagem nunca.
    const cabecalhos = parte.subarray(0, fimCab).toString("latin1");
    if (!/content-type:\s*(text\/plain|application\/json)/i.test(cabecalhos)) continue;
    const tamanho = numero(/content-length:\s*(\d+)/i.exec(cabecalhos)?.[1]);
    const corpoParte = parte.subarray(fimCab + sep, tamanho !== null ? fimCab + sep + tamanho : parte.length);
    eventos.push(...eventosDoJson(corpoParte.toString("utf8")));
  }
  return eventos;
}

export interface AcessoIntelbras {
  /** Número do usuário no terminal (o `identificador_catraca` do ARKE). */
  userId: string | null;
  /** Número do cartão lido, quando o usuário não veio resolvido. */
  cartao: string | null;
  /** 15 rosto, 44 rosto conferido no servidor, 6 digital, 1 cartão, 4 remoto. */
  metodo: number | null;
  entrada: boolean;
  /** 1: o terminal registrou a passagem como aceita. */
  status: number | null;
  /** Quando aconteceu, pelo relógio do terminal. */
  quando: Date | null;
  mac: string | null;
}

/** O evento de acesso, ou null para os outros (porta, arrombamento, cadastro...). */
export function acessoDoEvento(ev: EventoIntelbras): AcessoIntelbras | null {
  if (ev.code !== "AccessControl") return null;
  const d = ev.data;
  const utc = numero(d.UTC ?? d.CreateTime);
  return {
    userId: texto(d.UserID),
    cartao: texto(d.CardNo),
    metodo: numero(d.Method),
    entrada: String(d.Type ?? "Entry").toLowerCase() !== "exit",
    status: numero(d.Status),
    quando: utc !== null ? new Date(utc * 1000) : null,
    mac: ev.mac,
  };
}

/**
 * O número que vai à nuvem: o usuário do terminal, quando ele reconheceu a
 * pessoa (rosto, digital ou cartão cadastrado nele); senão o número do
 * cartão lido, sem zeros à esquerda e em maiúsculas (o cartão pode vir em
 * hexadecimal) — é o que a recepção põe na ficha, como na Toletus.
 */
export function identificadorDoAcesso(a: AcessoIntelbras): string | null {
  if (a.userId && a.userId !== "0") return a.userId;
  if (a.cartao) {
    const c = a.cartao.trim().toUpperCase().replace(/^0+(?=.)/, "");
    return c || null;
  }
  return null;
}

/** Pedido de agora ou registro guardado enquanto o terminal estava sem o Gateway? */
export function ehPedidoDeAcesso(eventos: EventoIntelbras[], acesso: AcessoIntelbras, agora: Date = new Date()): boolean {
  if (eventos.filter((e) => e.code === "AccessControl").length !== 1) return false;
  if (!acesso.quando) return true;
  return Math.abs(agora.getTime() - acesso.quando.getTime()) <= JANELA_TEMPO_REAL_MS;
}

/**
 * A resposta do Modo Online. `message` aparece no display, que é público:
 * boas-vindas sem o nome, negativa sem falar de dinheiro. `code` vai como
 * texto, como na documentação; `auth` "true" aciona o relé.
 */
export function respostaOnline(liberado: boolean, motivo = ""): { message: string; code: string; auth: "true" | "false" } {
  return { message: mensagemDoDisplay(liberado, motivo), code: "200", auth: liberado ? "true" : "false" };
}

/** Resposta a evento que não pede decisão (histórico, porta, alarme): não aciona nada. */
export function respostaNeutra(): { message: string; code: string; auth: "false" } {
  return { message: "", code: "200", auth: "false" };
}

// ——— API CGI ———

/** As chamadas CGI respondem "OK\r\n" quando dá certo (é o que os testes da coleção oficial conferem). */
export function respostaOk(corpo: unknown): boolean {
  return String(corpo ?? "").trim().toUpperCase() === "OK";
}

/** Respostas "chave=valor", uma por linha. */
export function lerChaveValor(corpo: unknown): Record<string, string> {
  const r: Record<string, string> = {};
  for (const linha of String(corpo ?? "").split(/\r?\n/)) {
    const i = linha.indexOf("=");
    if (i > 0) r[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  return r;
}

const DATA_INICIO = "2020-01-01 00:00:00";
const DATA_FIM = "2037-12-31 23:59:59";

/**
 * O aluno no terminal. O nome é "Aluno", e não o da pessoa: o display é
 * público. `UserType` 5 é "desativado", e o terminal recusa sozinho; é como
 * o Gateway espelha quem a academia barrou (pausado, inadimplente fora da
 * tolerância), para o caso de o terminal ficar sem o Gateway (decisão do
 * responsável de 02/10/2026).
 */
export function usuarioDoAluno(userId: number | string, desativado = false): Objeto {
  return {
    UserID: String(userId),
    UserName: "Aluno",
    UserType: desativado ? 5 : 0,
    UserStatus: 0,
    Authority: 2,
    Doors: [0],
    TimeSections: [255],
    SpecialDaysSchedule: [255],
    ValidFrom: DATA_INICIO,
    ValidTo: DATA_FIM,
  };
}

export const caminhos = {
  inserirUsuarios: "/cgi-bin/AccessUser.cgi?action=insertMulti",
  atualizarUsuarios: "/cgi-bin/AccessUser.cgi?action=updateMulti",
  removerUsuario: (id: number | string) => `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(String(id))}`,
  listarUsuario: (id: number | string) => `/cgi-bin/AccessUser.cgi?action=list&UserIDList[0]=${encodeURIComponent(String(id))}`,
  inserirRostos: "/cgi-bin/AccessFace.cgi?action=insertMulti",
  atualizarRostos: "/cgi-bin/AccessFace.cgi?action=updateMulti",
  removerRosto: (id: number | string) => `/cgi-bin/AccessFace.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(String(id))}`,
  abrirPorta: (canal: number) => `/cgi-bin/accessControl.cgi?action=openDoor&channel=${canal}&Type=Remote`,
  versao: "/cgi-bin/magicBox.cgi?action=getSoftwareVersion",
  acertarHora: (hora: string) => `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(hora)}`,
  /** O servidor de eventos: para onde o terminal manda cada tentativa. */
  servidorEventos: (endereco: string, porta: number) =>
    `/cgi-bin/configManager.cgi?action=setConfig&PictureHttpUpload.Enable=true` +
    `&PictureHttpUpload.UploadServerList[0].Address=${encodeURIComponent(endereco)}` +
    `&PictureHttpUpload.UploadServerList[0].Port=${porta}` +
    `&PictureHttpUpload.UploadServerList[0].Uploadpath=/notification`,
  /**
   * O Modo Online: o terminal pergunta ao servidor a cada acesso. Keepalive a
   * cada 10 s (a recomendação da documentação), 2 s para ele responder, e
   * 5 s para a decisão, bem acima do segundo que o Gateway leva no pior caso
   * (nuvem lenta e resposta pelo cache).
   */
  modoOnline:
    "/cgi-bin/configManager.cgi?action=setConfig&Intelbras_ModeCfg.DeviceMode=2" +
    "&Intelbras_ModeCfg.KeepAlive.Enable=true&Intelbras_ModeCfg.KeepAlive.Interval=10" +
    "&Intelbras_ModeCfg.KeepAlive.Path=/keepalive&Intelbras_ModeCfg.KeepAlive.TimeOut=2000" +
    "&Intelbras_ModeCfg.RemoteCheckTimeout=5",
};

/** O tamanho que a documentação aceita para a foto do rosto: JPEG de até 100 KB. */
export const FOTO_MAXIMA_BYTES = 100 * 1024;

/** A hora do terminal, no fuso de Brasília ("aaaa-mm-dd hh:mm:ss"). */
export function horaDoTerminal(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(agora)
    .replace("T", " ");
}

// ——— Autenticação Digest (RFC 2617) ———

export interface DesafioDigest {
  realm: string;
  nonce: string;
  qop: string | null;
  opaque: string | null;
  algorithm: string | null;
}

/** Lê o cabeçalho `WWW-Authenticate: Digest ...` do 401. null se não for Digest. */
export function lerDesafio(cabecalho: string | null | undefined): DesafioDigest | null {
  const s = String(cabecalho ?? "");
  if (!/^\s*digest\s/i.test(s)) return null;
  const campo = (nome: string) => new RegExp(`${nome}="?([^",]+)"?`, "i").exec(s)?.[1] ?? null;
  const realm = campo("realm");
  const nonce = campo("nonce");
  if (!realm || !nonce) return null;
  const qop = campo("qop");
  return {
    realm,
    nonce,
    // "auth,auth-int": usamos "auth".
    qop: qop ? (qop.split(",").map((q) => q.trim()).includes("auth") ? "auth" : qop.split(",")[0].trim()) : null,
    opaque: campo("opaque"),
    algorithm: campo("algorithm"),
  };
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** O cabeçalho `Authorization: Digest ...` de um pedido. */
export function autorizacaoDigest(p: {
  usuario: string;
  senha: string;
  metodo: string;
  uri: string;
  desafio: DesafioDigest;
  nc: number;
  cnonce?: string;
}): string {
  const cnonce = p.cnonce ?? randomBytes(8).toString("hex");
  const nc = p.nc.toString(16).padStart(8, "0");
  const ha1 = md5(`${p.usuario}:${p.desafio.realm}:${p.senha}`);
  const ha2 = md5(`${p.metodo.toUpperCase()}:${p.uri}`);
  const resposta = p.desafio.qop
    ? md5(`${ha1}:${p.desafio.nonce}:${nc}:${cnonce}:${p.desafio.qop}:${ha2}`)
    : md5(`${ha1}:${p.desafio.nonce}:${ha2}`);
  const partes = [
    `username="${p.usuario}"`,
    `realm="${p.desafio.realm}"`,
    `nonce="${p.desafio.nonce}"`,
    `uri="${p.uri}"`,
    `response="${resposta}"`,
  ];
  if (p.desafio.algorithm) partes.push(`algorithm=${p.desafio.algorithm}`);
  if (p.desafio.opaque) partes.push(`opaque="${p.desafio.opaque}"`);
  if (p.desafio.qop) partes.push(`qop=${p.desafio.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${partes.join(", ")}`;
}

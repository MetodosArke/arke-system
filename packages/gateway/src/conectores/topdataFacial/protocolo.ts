/**
 * Protocolo dos leitores faciais da Topdata (leitores F4, T4 e T4-50k e as
 * catracas da linha Easy: Fit Easy, Revolution Easy, Box Easy).
 *
 * Transcrito da página "Comandos do Leitor Facial" do portal de integradores
 * da Topdata (integrador.topdata.com.br/suporte/comandos-leitor-facial/),
 * conferida em 02/10/2026. Não há DLL nem ponte: o leitor fala JSON por
 * WebSocket, e quem disca é ele, para o servidor configurado no menu
 * (Configurações → Rede → Servidor, porta padrão 7792).
 *
 * Mensagens do leitor têm `cmd` (`reg`, `sendlog`, `senduser`); as nossas
 * ordens também têm `cmd`, e a resposta do leitor vem com `ret` igual ao
 * nome da ordem. Não há número de pedido: a resposta se reconhece pelo
 * `ret`, e por isso as ordens a um leitor vão uma de cada vez.
 *
 * Este módulo é só tradução, sem rede.
 */

import { mensagemDoDisplay } from "../toletus/protocolo";

/** Porta padrão do servidor no menu do leitor. */
export const PORTA_FACIAL_TOPDATA = 7792;

/** enrollid que o leitor usa para rosto que não conhece. */
export const ENROLLID_DESCONHECIDO = 99999999;

/** Registro de acesso lido muito depois de acontecer é histórico, não pedido de acesso. */
export const JANELA_TEMPO_REAL_MS = 120_000;

const FUSO = "America/Sao_Paulo";

/**
 * Hora no formato do leitor ("2025-02-26 11:40:21"), no fuso de Brasília:
 * é a hora da academia, e o leitor mostra na tela.
 */
export function horaDoLeitor(agora: Date = new Date()): string {
  // sv-SE escreve exatamente "aaaa-mm-dd hh:mm:ss".
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: FUSO,
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

/** Lê a hora do leitor, que está em Brasília. null se não der para ler. */
export function lerHoraDoLeitor(texto: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(texto ?? "").trim());
  if (!m) return null;
  // Brasília não tem horário de verão desde 2019: UTC−3 o ano todo.
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : null;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface RegistroLeitor {
  sn: string;
  modelo: string | null;
  firmware: string | null;
  usuarios: number | null;
  rostos: number | null;
}

/** Um acesso informado pelo leitor, já sem a foto. */
export interface RegistroAcesso {
  enrollid: number | null;
  /** 2 senha, 3 cartão, 8 rosto (página de comandos). */
  modo: number | null;
  sentido: number | null;
  evento: number | null;
  hora: Date | null;
  desconhecido: boolean;
}

export type MensagemDoLeitor =
  | { tipo: "reg"; registro: RegistroLeitor }
  | { tipo: "sendlog"; sn: string | null; registros: RegistroAcesso[] }
  | { tipo: "senduser"; enrollid: number | null }
  | { tipo: "resposta"; ret: string; sucesso: boolean; motivo: number | null; mensagem: string | null; dados: Objeto }
  | { tipo: "ignorado" };

/**
 * O que o leitor mandou.
 *
 * FOTO. O `sendlog` de rosto desconhecido traz a foto da pessoa em base64
 * (`image`), e o `getuserinfo` com `backupnum` 50 traz a foto de cadastro.
 * Aqui a foto do `sendlog` é descartada na leitura: ela não entra no
 * evento, não vai para log, não vai para a nuvem. Rosto de quem não é
 * aluno, na frente da catraca, não tem por que sair do equipamento.
 */
export function interpretarMensagem(bruto: string): MensagemDoLeitor {
  let msg: Objeto | null;
  try {
    msg = objeto(JSON.parse(bruto));
  } catch {
    return { tipo: "ignorado" };
  }
  if (!msg) return { tipo: "ignorado" };

  const ret = texto(msg.ret);
  if (ret) {
    const { ret: _r, result, reason, msg: mensagem, ...dados } = msg;
    return {
      tipo: "resposta",
      ret: ret.toLowerCase(),
      sucesso: result === true || result === 1 || result === "true",
      motivo: numero(reason ?? msg.reson),
      mensagem: texto(mensagem),
      dados,
    };
  }

  switch (String(msg.cmd ?? "").toLowerCase()) {
    case "reg": {
      const info = objeto(msg.devinfo);
      const sn = texto(msg.sn);
      if (!sn) return { tipo: "ignorado" };
      return {
        tipo: "reg",
        registro: {
          sn,
          modelo: texto(info?.modelname),
          firmware: texto(info?.firmware),
          usuarios: numero(info?.useduser),
          rostos: numero(info?.usedface),
        },
      };
    }
    case "sendlog": {
      const lista = Array.isArray(msg.record) ? msg.record : [];
      const registros = lista.map((r): RegistroAcesso => {
        const o = objeto(r) ?? {};
        const enrollid = numero(o.enrollid);
        const evento = numero(o.event);
        return {
          enrollid,
          modo: numero(o.mode),
          sentido: numero(o.inout),
          evento,
          hora: lerHoraDoLeitor(o.time),
          desconhecido: enrollid === null || enrollid === ENROLLID_DESCONHECIDO || evento === 2,
        };
      });
      return { tipo: "sendlog", sn: texto(msg.sn), registros };
    }
    case "senduser":
      return { tipo: "senduser", enrollid: numero(msg.enrollid) };
    default:
      return { tipo: "ignorado" };
  }
}

/**
 * Um `sendlog` é pedido de acesso quando traz um registro só, de agora.
 * Depois de reconectar, o leitor manda os registros guardados enquanto
 * estava sem servidor — esses são histórico, e respondê-los com
 * "liberado" poderia abrir a catraca para ninguém.
 */
export function ehPedidoDeAcesso(registros: RegistroAcesso[], agora: Date = new Date()): boolean {
  if (registros.length !== 1) return false;
  const hora = registros[0].hora;
  if (!hora) return true;
  return Math.abs(agora.getTime() - hora.getTime()) <= JANELA_TEMPO_REAL_MS;
}

/** Resposta obrigatória ao `reg`: sem ela o leitor repete e a conexão cai. */
export function respostaReg(agora?: Date): string {
  return JSON.stringify({ ret: "reg", result: true, cloudtime: horaDoLeitor(agora) });
}

/** Leitor fora do config.json: a resposta diz não, e a conexão fecha. */
export function respostaRegRecusado(agora?: Date): string {
  return JSON.stringify({ ret: "reg", result: false, cloudtime: horaDoLeitor(agora) });
}

/**
 * A decisão de acesso. `message` aparece na tela do leitor, que é pública
 * como o display da catraca: boas-vindas sem o nome, e negativa sem falar
 * de dinheiro.
 */
export function respostaAcesso(liberado: boolean, motivo: string, agora?: Date): string {
  return JSON.stringify({
    ret: "sendlog",
    result: true,
    cloudtime: horaDoLeitor(agora),
    message: mensagemDoDisplay(liberado, motivo),
    access: liberado,
  });
}

/**
 * Recebido, sem decisão nossa. Histórico de um leitor que decide vai com
 * `access: false`, por segurança: nada ali é pedido de agora. Aviso de um
 * leitor que só identifica (modo offline) vai sem `access`: a decisão foi
 * dele, e quem libera é a placa Inner.
 */
export function respostaRecebido(comAcessoNegado: boolean, agora?: Date): string {
  return JSON.stringify({
    ret: "sendlog",
    result: true,
    cloudtime: horaDoLeitor(agora),
    ...(comAcessoNegado ? { access: false } : {}),
  });
}

export function respostaSenduser(agora?: Date): string {
  return JSON.stringify({ ret: "senduser", result: true, cloudtime: horaDoLeitor(agora) });
}

/**
 * Modo de verificação. Quem decide (linha Easy) fica em "só online"
 * (`server_verify` 1): sem o Gateway, o leitor nega — é a regra do ARKE,
 * e não depende de o instalador lembrar, porque vai a cada conexão. E
 * `stranger_lock` 0: rosto desconhecido não entra.
 *
 * Quem só identifica (catraca Fit 4 Facial, em que a placa Inner pergunta à
 * ponte) fica em "só offline" (0): o leitor reconhece sozinho e passa o
 * número à placa, e a decisão continua na ponte. Online, ele esperaria a
 * nossa resposta antes, e o acesso seria decidido duas vezes.
 */
export function ordemModo(decide: boolean): Objeto {
  return { cmd: "setdevinfo", server_verify: decide ? 1 : 0, stranger_lock: 0 };
}

/**
 * Cria ou atualiza o aluno no leitor. O nome é "Aluno", e não o nome da
 * pessoa: a tela do leitor é pública. `card` vai só quando o leitor passa o
 * número adiante pela ligação física (Fit 4 Facial): é ele que a placa Inner
 * lê como cartão, e por isso é o mesmo identificador do ARKE.
 */
export function ordemUsuario(enrollid: number, opcoes: { cartao?: boolean } = {}): Objeto {
  return {
    cmd: "setuserinfo",
    enrollid,
    name: "Aluno",
    backupnum: 0,
    admin: 0,
    enable: 1,
    record: "0",
    ...(opcoes.cartao ? { card: enrollid } : {}),
  };
}

/**
 * O aluno com a foto do rosto (`backupnum` 50, a foto em base64 no
 * `record`). O leitor gera o reconhecimento a partir dela. A página de
 * comandos recomenda até 150 KB, idealmente 480x640.
 */
export function ordemFoto(enrollid: number, jpeg: Buffer, opcoes: { cartao?: boolean } = {}): Objeto {
  return {
    ...ordemUsuario(enrollid, opcoes),
    backupnum: 50,
    record: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
  };
}

/** Pede ao leitor a foto de cadastro do aluno, para copiá-la aos outros leitores. */
export function ordemLerFoto(enrollid: number): Objeto {
  return { cmd: "getuserinfo", enrollid, backupnum: 50 };
}

/** A foto que veio no `record` do getuserinfo, com ou sem o prefixo data:. */
export function fotoDaResposta(dados: Record<string, unknown>): Buffer | null {
  const record = typeof dados.record === "string" ? dados.record.trim() : "";
  if (!record || record === "0") return null;
  const base64 = record.replace(/^data:image\/[a-z]+;base64,/i, "");
  const foto = Buffer.from(base64, "base64");
  return foto.length > 100 ? foto : null;
}

/** Apaga o aluno inteiro do leitor: rosto, cartão e senha (`backupnum` 0). */
export function ordemApagar(enrollid: number): Objeto {
  return { cmd: "deleteuser", enrollid, backupnum: 0 };
}

/**
 * Apagar quem já não está no leitor conta como feito. O leitor responde
 * `result: false` com o motivo 1 ("usuário não encontrado").
 */
export function apagarConcluido(resposta: { sucesso: boolean; motivo: number | null; mensagem: string | null }): boolean {
  if (resposta.sucesso) return true;
  if (resposta.motivo === 1) return true;
  return /not find|no data|have no/i.test(resposta.mensagem ?? "");
}

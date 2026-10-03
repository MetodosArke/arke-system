/**
 * Protocolo da placa Toletus LiteNet3.
 *
 * Transcrito do pacote oficial de integração da Toletus
 * (github.com/Toletus/LiteNet3-IntegrationPackage) e da documentação da API
 * do Toletus Hub, conferidos em 02/10/2026. Não há manual de bytes como na
 * LiteNet2: a LiteNet3 fala JSON, e é o código-fonte do pacote que define
 * as mensagens.
 *
 * O sentido da conexão é o contrário da LiteNet2 e igual ao da Control iD:
 *
 *   1. o Gateway manda, por UDP para a porta 7878 da placa,
 *      `{"update":"server","data":{"serial":…,"uri":"ws://IP:PORTA"}}`;
 *   2. a placa disca para esse endereço por WebSocket, com os cabeçalhos
 *      `x-api-key` (a chave fixa do firmware) e `Serial`;
 *   3. a conversa segue em mensagens JSON de texto, nos dois sentidos.
 *
 * Toda mensagem tem uma chave de tipo (`notification`, `fetch`, `update`,
 * `action`) e os dados em `data`. O pacote oficial lê os nomes sem
 * diferenciar maiúsculas (Newtonsoft), então aqui também.
 *
 * Este módulo é só tradução, sem rede: é a parte que os testes conferem
 * mensagem a mensagem.
 */

import type { SentidoLiberacao } from "../placa";
import { mensagemDoDisplay } from "../protocolo";

/** Porta UDP da placa: descoberta e endereço do servidor. */
export const PORTA_UDP_LITENET3 = 7878;

/**
 * Chave que o firmware manda no cabeçalho `x-api-key`. É fixa no firmware e
 * pública no pacote da Toletus: não autentica ninguém, só confirma que quem
 * discou é uma LiteNet3. Quem a placa é, decide o `Serial`, conferido contra
 * a lista do config.
 */
export const CHAVE_API_LITENET3 = "12345-abcde-67890-fghij";

/** Linha do display: 16 caracteres, sem acento (o display não tem). */
export const TAMANHO_LINHA = 16;

export function linhaDoDisplay(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .slice(0, TAMANHO_LINHA);
}

/** Pedido de descoberta, por UDP: a placa responde com serial, id, firmware e o servidor atual. */
export function mensagemDescoberta(): string {
  return JSON.stringify({ fetch: "discovery", data: null });
}

/** Diz à placa para qual endereço discar. */
export function mensagemServidor(serial: string, uri: string): string {
  return JSON.stringify({ update: "server", data: { serial, uri } });
}

export type { SentidoLiberacao };

const RELEASE: Record<SentidoLiberacao, string> = { entrada: "In", saida: "Out", ambos: "Both" };

/** Libera um giro, com as duas linhas do display. */
export function mensagemLiberar(sentido: SentidoLiberacao, topo: string, baixo = ""): string {
  return JSON.stringify({
    action: "litenet3",
    data: { release: RELEASE[sentido], topRow: linhaDoDisplay(topo), bottomRow: linhaDoDisplay(baixo) },
  });
}

/**
 * Mensagem temporária no display. "temporary" é a opção "Notificação
 * temporária" do gerenciador da Toletus; a única chamada documentada usa
 * "clear". O valor exato confere-se na bancada — se a placa recusar, a
 * catraca continua travada do mesmo jeito: negar é só avisar.
 */
export function mensagemTemporaria(topo: string, baixo = "", duracaoMs = 3000): string {
  return JSON.stringify({
    action: "display",
    data: {
      cmd: "temporary",
      time: duracaoMs,
      topRow: linhaDoDisplay(topo),
      bottomRow: linhaDoDisplay(baixo),
      alignBot: "center",
    },
  });
}

/** O toque de erro do exemplo oficial da API (formato RTTTL). */
export const TOQUE_ERRO = "err:d=4,o=4,b=180:f#,32p,f#";

export function mensagemToque(toque: string): string {
  return JSON.stringify({ action: "buzzer", data: { play: toque } });
}

export function mensagemConsulta(o: "factory" | "litenet3" | "flow" | "sensor"): string {
  return JSON.stringify({ fetch: o, data: null });
}

/** As mensagens que negam um acesso: texto no display e toque de erro. */
export function mensagensNegar(motivo: string): string[] {
  return [mensagemTemporaria(motivo), mensagemToque(TOQUE_ERRO)];
}

/** A frase do display, a mesma da LiteNet2: o display é público. */
export { mensagemDoDisplay };

export type OrigemLiteNet3 = "rfid" | "codigo_barras" | "teclado";

export type EventoLiteNet3 =
  | { tipo: "identificacao"; origem: OrigemLiteNet3; valor: string }
  | { tipo: "passagem"; direcao: "entrada" | "saida" | "indefinida" }
  | { tipo: "tempo_esgotado" }
  /**
   * A LiteNet3 com leitor de digital manda a IMAGEM do dedo, em pedaços,
   * para o servidor comparar. O ARKE não compara digital no servidor, por
   * desenho: dado biométrico não sai do equipamento para decidir acesso.
   * O conteúdo nunca é guardado nem registrado.
   */
  | { tipo: "biometria" }
  | { tipo: "ping" }
  | { tipo: "erro"; dispositivo: string }
  | { tipo: "fabrica"; serial: string | null; firmware: string | null; hardware: string | null }
  | { tipo: "resposta"; chave: string; resultado: string | null; motivo: string | null }
  | { tipo: "ignorado" };

export interface Descoberta {
  serial: string | null;
  id: number | null;
  firmware: string | null;
  servidor: string | null;
}

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : null;
}

/** Lê uma chave sem diferenciar maiúsculas, como o Newtonsoft do pacote oficial. */
function campo(o: Objeto | null, nome: string): unknown {
  if (!o) return undefined;
  if (nome in o) return o[nome];
  const alvo = nome.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === alvo) return o[k];
  return undefined;
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

export function lerJson(bruto: string): Objeto | null {
  try {
    return objeto(JSON.parse(bruto));
  } catch {
    return null;
  }
}

/** A resposta da placa ao pedido de descoberta, ou null se não for uma. */
export function lerDescoberta(bruto: string): Descoberta | null {
  const msg = lerJson(bruto);
  if (!msg || String(campo(msg, "fetch") ?? "").toLowerCase() !== "discovery") return null;
  const dados = objeto(campo(msg, "data"));
  if (!dados) return null;
  return {
    serial: texto(campo(dados, "serial")),
    id: numero(campo(dados, "id")),
    firmware: texto(campo(dados, "firmware")),
    servidor: texto(campo(dados, "serverUri")),
  };
}

/**
 * Contadores da última passagem de cada placa. A passagem chega com `in`
 * e/ou `out`; o pacote oficial não diz se são contadores acumulados (como
 * os de GetSensor) ou só a marca do sentido. Lemos dos dois jeitos: se só
 * um vem, é aquele sentido; se os dois vêm, é o que subiu desde a última.
 */
export interface ContadoresPassagem {
  entrada: number | null;
  saida: number | null;
}

export function direcaoDaPassagem(
  dados: Objeto | null,
  anterior: ContadoresPassagem | null
): { direcao: "entrada" | "saida" | "indefinida"; contadores: ContadoresPassagem } {
  const entrada = numero(campo(dados, "in"));
  const saida = numero(campo(dados, "out"));
  const contadores = { entrada, saida };
  if (entrada !== null && saida === null) return { direcao: "entrada", contadores };
  if (saida !== null && entrada === null) return { direcao: "saida", contadores };
  if (entrada !== null && saida !== null && anterior) {
    if (anterior.entrada !== null && entrada > anterior.entrada) return { direcao: "entrada", contadores };
    if (anterior.saida !== null && saida > anterior.saida) return { direcao: "saida", contadores };
  }
  return { direcao: "indefinida", contadores };
}

/**
 * O que uma mensagem recebida da placa significa. `contadores` é o estado
 * da última passagem daquela placa, que o chamador guarda e devolve.
 */
export function interpretarMensagem(
  bruto: string,
  contadores: ContadoresPassagem | null = null
): { evento: EventoLiteNet3; contadores: ContadoresPassagem | null } {
  const msg = lerJson(bruto);
  if (!msg) return { evento: { tipo: "ignorado" }, contadores };
  const dados = objeto(campo(msg, "data"));

  const notificacao = campo(msg, "notification");
  if (notificacao !== undefined) {
    switch (String(notificacao).toLowerCase()) {
      case "rfid":
      case "barcode":
      case "keypad": {
        const tipo = String(notificacao).toLowerCase();
        const origem: OrigemLiteNet3 = tipo === "rfid" ? "rfid" : tipo === "barcode" ? "codigo_barras" : "teclado";
        const lido = texto(campo(dados, "code")) ?? "";
        // Teclado preserva os zeros (CPF começa com zero muitas vezes); o
        // número do cartão vale sem eles, como na LiteNet2.
        const valor = origem === "teclado" ? lido : lido.replace(/^0+(?=.)/, "");
        return { evento: { tipo: "identificacao", origem, valor }, contadores };
      }
      case "passage": {
        const { direcao, contadores: novos } = direcaoDaPassagem(dados, contadores);
        return { evento: { tipo: "passagem", direcao }, contadores: novos };
      }
      case "timeout":
        return { evento: { tipo: "tempo_esgotado" }, contadores };
      case "biometrics":
        return { evento: { tipo: "biometria" }, contadores };
      case "ping":
        return { evento: { tipo: "ping" }, contadores };
      case "error":
        return { evento: { tipo: "erro", dispositivo: texto(campo(dados, "device")) ?? "desconhecido" }, contadores };
      default:
        return { evento: { tipo: "ignorado" }, contadores };
    }
  }

  for (const chave of ["fetch", "update", "action"]) {
    const valor = campo(msg, chave);
    if (valor === undefined) continue;
    const nome = String(valor).toLowerCase();
    if (chave === "fetch" && nome === "factory" && dados && campo(dados, "result") === undefined) {
      return {
        evento: {
          tipo: "fabrica",
          serial: texto(campo(dados, "serial")),
          firmware: texto(campo(dados, "firmware")),
          hardware: texto(campo(dados, "hardware")),
        },
        contadores,
      };
    }
    // Resultado vem no topo da mensagem ou dentro de data, conforme o firmware.
    const resultado = texto(campo(msg, "result")) ?? texto(campo(dados, "result"));
    const motivo = texto(campo(msg, "reason")) ?? texto(campo(dados, "reason"));
    return { evento: { tipo: "resposta", chave: `${chave}:${nome}`, resultado, motivo }, contadores };
  }

  return { evento: { tipo: "ignorado" }, contadores };
}

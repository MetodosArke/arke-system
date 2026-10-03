import dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { logger } from "../../../logger";
import type { EstadoPlaca, PlacaConectavel } from "../placa";
import type { EventoToletus } from "../protocolo";
import {
  PORTA_UDP_LITENET3,
  interpretarMensagem,
  lerDescoberta,
  mensagemConsulta,
  mensagemDescoberta,
  mensagemLiberar,
  mensagemServidor,
  mensagensNegar,
  type ContadoresPassagem,
  type SentidoLiberacao,
} from "./protocolo";
import type { DestinoLiteNet3, ServidorLiteNet3 } from "./servidor";

/**
 * Uma placa Toletus LiteNet3.
 *
 * Quem disca é a placa, como na Control iD; o Gateway só precisa dizer a
 * ela para onde discar. Isso vai por UDP, na porta 7878 da placa: primeiro a
 * descoberta (para saber o serial, se o config não trouxer), depois o
 * endereço do servidor. Enquanto a placa não conecta, o anúncio se repete;
 * ela guarda o endereço, então depois de reiniciar volta sozinha.
 *
 * Duas regras do pacote oficial da Toletus valem aqui:
 *
 *   - **keepalive do WebSocket a cada 15 s**, com 10 s para a resposta.
 *     O comentário do pacote é direto: "o ESP32 exige este keepalive para
 *     ficar conectado, não desligue";
 *   - **uma conexão por placa**: a placa que reconecta substitui a anterior.
 *
 * E a do ARKE: sem o Gateway, ninguém manda liberar, e a catraca fica
 * travada no sentido controlado. A bancada confirma o que a placa faz sem
 * servidor — se ela tivesse um modo de liberar sozinha, a decisão de
 * acesso deixaria de ser nossa.
 */

export interface OpcoesPlacaLiteNet3 {
  nome: string;
  ip: string;
  /** Serial da placa, se o instalador anotou. Sem ele, vem da descoberta. */
  serial?: string | null;
  servidor: ServidorLiteNet3;
  /** Endereço deste computador que a placa alcança. Sem ele, o sistema escolhe a interface. */
  enderecoAnunciado?: string | null;
  portaUdp?: number;
  intervaloAnuncioMs?: number;
  intervaloVidaMs?: number;
  /** Quanto esperar o pong antes de dar a conexão como morta. */
  esperaPongMs?: number;
}

export class PlacaLiteNet3 extends EventEmitter implements DestinoLiteNet3, PlacaConectavel {
  readonly nome: string;
  readonly ip: string;
  private readonly serialConfigurado: string | null;
  private serialDescoberto: string | null = null;
  private readonly servidor: ServidorLiteNet3;
  private readonly enderecoAnunciado: string | null;
  private readonly portaUdp: number;
  private readonly intervaloAnuncioMs: number;
  private readonly intervaloVidaMs: number;
  private readonly esperaPongMs: number;

  private ws: WebSocket | null = null;
  private rodando = false;
  private timerAnuncio: NodeJS.Timeout | null = null;
  private timerVida: NodeJS.Timeout | null = null;
  private pongPendenteDesde: number | null = null;
  private contadores: ContadoresPassagem | null = null;
  private firmware: string | null = null;
  private vistaEm: Date | null = null;
  private desconectadaEm: Date | null = null;

  constructor(opcoes: OpcoesPlacaLiteNet3) {
    super();
    this.nome = opcoes.nome;
    this.ip = opcoes.ip;
    this.serialConfigurado = opcoes.serial?.trim() || null;
    this.servidor = opcoes.servidor;
    this.enderecoAnunciado = opcoes.enderecoAnunciado?.trim() || null;
    this.portaUdp = opcoes.portaUdp ?? PORTA_UDP_LITENET3;
    this.intervaloAnuncioMs = opcoes.intervaloAnuncioMs ?? 10_000;
    this.intervaloVidaMs = opcoes.intervaloVidaMs ?? 15_000;
    this.esperaPongMs = opcoes.esperaPongMs ?? 10_000;
    this.servidor.registrar(this);
  }

  serial(): string | null {
    return this.serialConfigurado ?? this.serialDescoberto;
  }

  private get conectada(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  estado(): EstadoPlaca {
    return {
      nome: this.nome,
      conectada: this.conectada,
      firmware: this.firmware,
      serial: this.serial(),
      vistaEm: this.vistaEm,
      desconectadaEm: this.desconectadaEm,
    };
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;
    this.agendarAnuncio(0);
  }

  parar(): void {
    this.rodando = false;
    if (this.timerAnuncio) clearTimeout(this.timerAnuncio);
    this.timerAnuncio = null;
    this.pararVida();
    this.ws?.terminate();
    this.ws = null;
  }

  /** Manda uma mensagem. false: a placa não está conectada, e quem pediu precisa saber. */
  enviar(mensagem: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(mensagem, (err) => {
        if (err) logger.warn({ placa: this.nome, err: err.message }, "Falha ao enviar à placa LiteNet3");
      });
      return true;
    } catch (err) {
      logger.warn({ placa: this.nome, err: (err as Error).message }, "Falha ao enviar à placa LiteNet3");
      return false;
    }
  }

  liberar(sentido: SentidoLiberacao, mensagem: string): boolean {
    return this.enviar(mensagemLiberar(sentido, mensagem));
  }

  /** A borboleta já está travada: negar é só avisar quem está na frente dela. */
  negar(mensagem: string): boolean {
    return mensagensNegar(mensagem).map((m) => this.enviar(m)).every(Boolean);
  }

  /** Chamado pelo servidor quando esta placa disca. */
  aceitar(ws: WebSocket, serial: string): void {
    if (this.serialConfigurado && serial !== this.serialConfigurado) {
      ws.close(1008, "serial diferente do configurado");
      return;
    }
    this.serialDescoberto = serial;
    const anterior = this.ws;
    this.ws = ws;
    // Placa que reconecta substitui a conexão anterior, como no pacote oficial.
    if (anterior && anterior !== ws) anterior.terminate();

    if (this.timerAnuncio) clearTimeout(this.timerAnuncio);
    this.timerAnuncio = null;
    this.vistaEm = new Date();
    logger.info({ placa: this.nome, serial }, "Placa Toletus LiteNet3 conectada");
    this.emit("conectada");
    // Firmware e hardware vão para a telemetria.
    this.enviar(mensagemConsulta("factory"));
    this.iniciarVida(ws);

    ws.on("message", (dados, binario) => {
      if (this.ws !== ws) return;
      this.vistaEm = new Date();
      if (binario) return;
      this.tratar(dados.toString());
    });
    ws.on("pong", () => {
      if (this.ws !== ws) return;
      this.pongPendenteDesde = null;
      this.vistaEm = new Date();
    });
    ws.on("error", (err) => logger.warn({ placa: this.nome, err: err.message }, "Erro na conexão com a placa LiteNet3"));
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.pararVida();
      this.desconectadaEm = new Date();
      logger.warn({ placa: this.nome }, "Placa Toletus LiteNet3 desconectada");
      this.emit("desconectada");
      // A placa tenta voltar sozinha; o anúncio só ajuda se ela tiver perdido o endereço.
      if (this.rodando) this.agendarAnuncio(this.intervaloAnuncioMs);
    });
  }

  private tratar(bruto: string): void {
    const { evento, contadores } = interpretarMensagem(bruto, this.contadores);
    this.contadores = contadores;
    switch (evento.tipo) {
      case "identificacao":
        this.emit("evento", { tipo: "identificacao", origem: evento.origem, valor: evento.valor } satisfies EventoToletus);
        return;
      case "passagem":
        this.emit("evento", { tipo: "passagem", direcao: evento.direcao } satisfies EventoToletus);
        return;
      case "tempo_esgotado":
        this.emit("evento", { tipo: "tempo_esgotado" } satisfies EventoToletus);
        return;
      case "biometria":
        this.emit("evento", { tipo: "biometria_imagem" } satisfies EventoToletus);
        return;
      case "fabrica":
        this.firmware = evento.firmware;
        if (evento.serial) this.serialDescoberto = this.serialDescoberto ?? evento.serial;
        return;
      case "erro":
        logger.warn({ placa: this.nome, dispositivo: evento.dispositivo }, "Placa LiteNet3 avisou erro num dispositivo");
        return;
      case "resposta":
        if (evento.resultado && evento.resultado.toLowerCase() !== "ok") {
          logger.warn(
            { placa: this.nome, mensagem: evento.chave, resultado: evento.resultado, motivo: evento.motivo },
            "Placa LiteNet3 recusou uma ordem"
          );
        }
        return;
      default:
        return;
    }
  }

  private iniciarVida(ws: WebSocket): void {
    this.pararVida();
    this.pongPendenteDesde = null;
    this.timerVida = setInterval(() => {
      if (this.ws !== ws) return;
      if (this.pongPendenteDesde !== null && Date.now() - this.pongPendenteDesde > this.esperaPongMs) {
        logger.warn({ placa: this.nome }, "Placa LiteNet3 parou de responder — fechando a conexão");
        ws.terminate();
        return;
      }
      if (this.pongPendenteDesde === null) this.pongPendenteDesde = Date.now();
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }, this.intervaloVidaMs);
    this.timerVida.unref?.();
  }

  private pararVida(): void {
    if (this.timerVida) clearInterval(this.timerVida);
    this.timerVida = null;
    this.pongPendenteDesde = null;
  }

  private agendarAnuncio(espera: number): void {
    if (!this.rodando || this.conectada) return;
    if (this.timerAnuncio) clearTimeout(this.timerAnuncio);
    this.timerAnuncio = setTimeout(() => {
      this.timerAnuncio = null;
      if (!this.rodando || this.conectada) return;
      this.anunciar();
      this.agendarAnuncio(this.intervaloAnuncioMs);
    }, espera);
    this.timerAnuncio.unref?.();
  }

  /**
   * Descoberta e endereço do servidor, por UDP. O socket é "conectado" à
   * placa para o sistema escolher a interface de saída: é o endereço dessa
   * interface que a placa vai alcançar, mesmo num computador com Wi-Fi e
   * cabo ao mesmo tempo.
   */
  private anunciar(): void {
    const udp = dgram.createSocket("udp4");
    const fechar = setTimeout(() => udp.close(), 2_000);
    fechar.unref?.();
    udp.on("error", (err) => {
      logger.warn({ placa: this.nome, ip: this.ip, err: err.message }, "Falha no anúncio UDP à placa LiteNet3");
      clearTimeout(fechar);
      try {
        udp.close();
      } catch {
        /* já fechado */
      }
    });
    udp.on("message", (bruto) => {
      const descoberta = lerDescoberta(bruto.toString());
      if (!descoberta?.serial) return;
      if (this.serialConfigurado && descoberta.serial !== this.serialConfigurado) {
        logger.warn(
          { placa: this.nome, ip: this.ip, configurado: this.serialConfigurado, encontrado: descoberta.serial },
          "A placa neste IP tem outro serial — confira o config.json"
        );
        return;
      }
      if (descoberta.firmware) this.firmware = descoberta.firmware;
      if (!this.serialDescoberto) this.serialDescoberto = descoberta.serial;
      this.mandarServidor(udp);
    });
    udp.connect(this.portaUdp, this.ip, () => {
      udp.send(mensagemDescoberta());
      // Com o serial já conhecido, o endereço vai junto, sem esperar a descoberta.
      if (this.serial()) this.mandarServidor(udp);
    });
  }

  private mandarServidor(udp: dgram.Socket): void {
    const serial = this.serial();
    if (!serial) return;
    let local: string;
    try {
      local = this.enderecoAnunciado ?? udp.address().address;
    } catch {
      return;
    }
    const uri = `ws://${local}:${this.servidor.portaEmUso()}`;
    try {
      udp.send(mensagemServidor(serial, uri));
      logger.debug({ placa: this.nome, uri }, "Endereço do Gateway anunciado à placa LiteNet3");
    } catch {
      /* o próximo anúncio tenta de novo */
    }
  }
}

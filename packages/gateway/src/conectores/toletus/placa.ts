import net from "node:net";
import { EventEmitter } from "node:events";
import { logger } from "../../logger";
import {
  COMANDO,
  COR,
  MontadorDePacotes,
  PORTA_TOLETUS,
  TOQUE,
  dadosDaNotificacao,
  interpretarPacote,
  montarPacote,
  textoParaDados,
  versaoDoFirmware,
  type EventoToletus,
} from "./protocolo";

/**
 * Conexão com uma placa Toletus LiteNet2.
 *
 * Aqui o sentido é o oposto da Control iD e da Topdata: a placa é o
 * servidor (porta 7878) e quem disca é o Gateway. Por isso a conexão é
 * nossa responsabilidade inteira: abrir, perceber que caiu e reabrir.
 *
 * Duas lições do pacote oficial da Toletus, que estão em produção na frota
 * deles, valem aqui:
 *
 *   - **sem keepalive do TCP.** O firmware não responde às sondas, e o
 *     keepalive derrubava a conexão ociosa em ~25 s. O sinal de vida é de
 *     aplicação: perguntar o id da placa a cada 10 s;
 *   - **reconexão sozinha**, com espera crescente até 5 s.
 *
 * E uma regra nossa: conexão que fica muda é tratada como morta. O pacote
 * oficial só percebe a queda quando o envio falha; um cabo arrancado sem o
 * outro lado avisar pode deixar o socket "aberto" por minutos, e nesse
 * tempo a academia fica sem catraca sem ninguém saber.
 */

export type SentidoLiberacao = "entrada" | "saida" | "ambos";

export interface OpcoesPlaca {
  nome: string;
  ip: string;
  porta?: number;
  /** De quanto em quanto tempo perguntar o id da placa. */
  intervaloVidaMs?: number;
  /** Sem nenhum byte da placa por este tempo, a conexão é dada como morta. */
  silencioMaximoMs?: number;
  conectarTimeoutMs?: number;
  esperaInicialMs?: number;
  esperaMaximaMs?: number;
}

export interface EstadoPlaca {
  nome: string;
  conectada: boolean;
  firmware: string | null;
  serial: string | null;
  /** Último byte recebido da placa. */
  vistaEm: Date | null;
  desconectadaEm: Date | null;
}

/**
 * O que o conector precisa de uma placa, seja LiteNet2 (o Gateway disca) ou
 * LiteNet3 (a placa disca). Eventos: "evento" (EventoToletus), "conectada"
 * e "desconectada".
 */
export interface PlacaConectavel extends EventEmitter {
  readonly nome: string;
  iniciar(): void;
  parar(): void;
  liberar(sentido: SentidoLiberacao, mensagem: string): boolean;
  negar(mensagem: string): boolean;
  estado(): EstadoPlaca;
}

export class PlacaToletus extends EventEmitter implements PlacaConectavel {
  readonly nome: string;
  private readonly ip: string;
  private readonly porta: number;
  private readonly intervaloVidaMs: number;
  private readonly silencioMaximoMs: number;
  private readonly conectarTimeoutMs: number;
  private readonly esperaInicialMs: number;
  private readonly esperaMaximaMs: number;

  private socket: net.Socket | null = null;
  private montador = new MontadorDePacotes();
  private rodando = false;
  private conectada = false;
  private espera: number;
  private timerReconexao: NodeJS.Timeout | null = null;
  private timerVida: NodeJS.Timeout | null = null;
  private firmware: string | null = null;
  private serial: string | null = null;
  private vistaEm: Date | null = null;
  private desconectadaEm: Date | null = null;

  constructor(opcoes: OpcoesPlaca) {
    super();
    this.nome = opcoes.nome;
    this.ip = opcoes.ip;
    this.porta = opcoes.porta ?? PORTA_TOLETUS;
    this.intervaloVidaMs = opcoes.intervaloVidaMs ?? 10_000;
    this.silencioMaximoMs = opcoes.silencioMaximoMs ?? 35_000;
    this.conectarTimeoutMs = opcoes.conectarTimeoutMs ?? 5_000;
    this.esperaInicialMs = opcoes.esperaInicialMs ?? 500;
    this.esperaMaximaMs = opcoes.esperaMaximaMs ?? 5_000;
    this.espera = this.esperaInicialMs;
  }

  estado(): EstadoPlaca {
    return {
      nome: this.nome,
      conectada: this.conectada,
      firmware: this.firmware,
      serial: this.serial,
      vistaEm: this.vistaEm,
      desconectadaEm: this.desconectadaEm,
    };
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;
    this.conectar();
  }

  parar(): void {
    this.rodando = false;
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    this.timerReconexao = null;
    this.pararVida();
    this.socket?.destroy();
    this.socket = null;
    this.conectada = false;
  }

  /**
   * Manda um pacote. Devolve false se a placa não está conectada ou a
   * escrita falhou: quem pediu uma liberação precisa saber que ela não saiu,
   * senão o acesso ficaria esperando um giro que nunca vai acontecer.
   */
  enviar(comando: number, dados?: Buffer): boolean {
    if (!this.conectada || !this.socket || this.socket.destroyed) return false;
    try {
      // write() devolve false só quando o buffer local enche; o pacote fica
      // na fila e sai do mesmo jeito.
      this.socket.write(montarPacote(comando, dados));
      return true;
    } catch (err) {
      logger.warn({ placa: this.nome, err: (err as Error).message }, "Falha ao escrever na placa Toletus");
      this.socket.destroy();
      return false;
    }
  }

  /** Libera um giro, com a mensagem no display (§2.3.1.1, §2.3.1.2, §2.3.1.6). */
  liberar(sentido: SentidoLiberacao, mensagem: string): boolean {
    const comando =
      sentido === "saida" ? COMANDO.LIBERA_SAIDA : sentido === "ambos" ? COMANDO.LIBERA_DOIS_SENTIDOS : COMANDO.LIBERA_ENTRADA;
    return this.enviar(comando, textoParaDados(mensagem));
  }

  /**
   * Nega com mensagem, toque de erro e leds vermelhos. A borboleta já está
   * travada — negar é só avisar quem está na frente dela. Firmware anterior
   * à V2.1.0 não tem estes dois comandos e os ignora; a catraca continua
   * travada do mesmo jeito.
   */
  negar(mensagem: string): boolean {
    const texto = this.enviar(COMANDO.MENSAGEM_TEMPORARIA, textoParaDados(mensagem));
    const aviso = this.enviar(COMANDO.NOTIFICA_USUARIO, dadosDaNotificacao(3000, TOQUE.ERRO, COR.VERMELHO, true));
    return texto && aviso;
  }

  /**
   * Mensagem no display sem mexer na borboleta: o passo a passo do cadastro
   * da digital, para o aluno que está com o dedo no leitor. "passo" fica
   * amarelo até o próximo aviso; "ok" e "erro" fecham o cadastro.
   */
  avisar(mensagem: string, tom: "passo" | "ok" | "erro"): boolean {
    const texto = this.enviar(COMANDO.MENSAGEM_TEMPORARIA, textoParaDados(mensagem));
    const notificacao =
      tom === "passo"
        ? dadosDaNotificacao(10_000, TOQUE.BEEP, COR.AMARELO, true)
        : tom === "ok"
          ? dadosDaNotificacao(3000, TOQUE.BEEP, COR.VERDE_DOS_DOIS_LADOS, true)
          : dadosDaNotificacao(3000, TOQUE.ERRO, COR.VERMELHO, true);
    return texto && this.enviar(COMANDO.NOTIFICA_USUARIO, notificacao);
  }

  private conectar(): void {
    if (!this.rodando) return;
    const socket = new net.Socket();
    this.socket = socket;
    this.montador = new MontadorDePacotes();
    socket.setNoDelay(true);
    // Sem keepalive do TCP, de propósito: ver o comentário da classe.
    socket.setKeepAlive(false);
    socket.setTimeout(this.conectarTimeoutMs);

    socket.once("connect", () => {
      socket.setTimeout(0);
      this.conectada = true;
      this.espera = this.esperaInicialMs;
      this.vistaEm = new Date();
      logger.info({ placa: this.nome, ip: this.ip }, "Placa Toletus conectada");
      this.emit("conectada");
      // Firmware e serial vão para a telemetria: é o que o suporte pergunta
      // primeiro quando uma catraca se comporta diferente.
      this.enviar(COMANDO.CONSULTA_FIRMWARE);
      this.enviar(COMANDO.CONSULTA_SERIAL);
      this.iniciarVida();
    });

    socket.on("data", (pedaco: Buffer) => {
      this.vistaEm = new Date();
      for (const pacote of this.montador.empurrar(pedaco)) {
        const evento = interpretarPacote(pacote);
        if (evento.tipo === "resposta") this.guardarResposta(evento.comando, evento.dados);
        else this.emit("evento", evento satisfies EventoToletus);
      }
    });

    socket.on("timeout", () => {
      logger.warn({ placa: this.nome, ip: this.ip }, "Placa Toletus não atendeu a conexão a tempo");
      socket.destroy();
    });

    socket.on("error", (err) => {
      // O "close" vem logo depois e cuida da reconexão; aqui só fica o porquê.
      logger.warn({ placa: this.nome, ip: this.ip, err: err.message }, "Erro na conexão com a placa Toletus");
    });

    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.pararVida();
      const estavaConectada = this.conectada;
      this.conectada = false;
      this.socket = null;
      if (estavaConectada) {
        this.desconectadaEm = new Date();
        logger.warn({ placa: this.nome, ip: this.ip }, "Placa Toletus desconectada");
        this.emit("desconectada");
      }
      this.agendarReconexao();
    });

    socket.connect(this.porta, this.ip);
  }

  private agendarReconexao(): void {
    if (!this.rodando) return;
    const espera = this.espera;
    this.espera = Math.min(this.espera * 2, this.esperaMaximaMs);
    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      this.conectar();
    }, espera);
    this.timerReconexao.unref?.();
  }

  private iniciarVida(): void {
    this.pararVida();
    this.timerVida = setInterval(() => {
      const silencio = Date.now() - (this.vistaEm?.getTime() ?? 0);
      if (silencio > this.silencioMaximoMs) {
        logger.warn(
          { placa: this.nome, silencioMs: silencio },
          "Placa Toletus parou de responder — reabrindo a conexão"
        );
        this.socket?.destroy();
        return;
      }
      this.enviar(COMANDO.CONSULTA_ID);
    }, this.intervaloVidaMs);
    this.timerVida.unref?.();
  }

  private pararVida(): void {
    if (this.timerVida) clearInterval(this.timerVida);
    this.timerVida = null;
  }

  private guardarResposta(comando: number, dados: Buffer): void {
    if (comando === COMANDO.CONSULTA_FIRMWARE) this.firmware = versaoDoFirmware(dados);
    else if (comando === COMANDO.CONSULTA_SERIAL) this.serial = String(dados.readUInt32LE(0));
  }
}

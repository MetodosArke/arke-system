import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { logger } from "../../logger";
import type { EquipamentoFacialTopdata } from "../../types";
import {
  interpretarMensagem,
  respostaReg,
  respostaSenduser,
  type RegistroAcesso,
  type RegistroLeitor,
} from "./protocolo";

/**
 * Um leitor facial da Topdata conectado ao Gateway.
 *
 * O leitor disca e se apresenta com o `reg`; o servidor o entrega aqui.
 * Daí em diante, o que chega dele são os acessos (`sendlog`), e o que vai
 * são as respostas e as ordens (cadastrar, apagar, configurar).
 *
 * As ordens vão uma de cada vez: a resposta do leitor não tem número de
 * pedido, só o nome da ordem (`ret`). Duas ordens iguais ao mesmo tempo
 * não teriam como ser separadas.
 */

export type { EquipamentoFacialTopdata };

export interface RespostaLeitor {
  sucesso: boolean;
  motivo: number | null;
  mensagem: string | null;
  dados: Record<string, unknown>;
}

export interface EstadoLeitor {
  nome: string;
  conectado: boolean;
  sn: string | null;
  modelo: string | null;
  firmware: string | null;
  vistoEm: Date | null;
  desconectadoEm: Date | null;
}

type Pendente = {
  ret: string;
  resolver: (r: RespostaLeitor) => void;
  rejeitar: (e: Error) => void;
  timer: NodeJS.Timeout;
};

export interface OpcoesLeitor {
  /** De quanto em quanto tempo mandar ping. */
  intervaloVidaMs?: number;
  /** Sem pong por este tempo, a conexão é dada como morta. */
  silencioMaximoMs?: number;
  /** Quanto esperar a resposta de uma ordem. */
  timeoutOrdemMs?: number;
}

export class LeitorFacialTopdata extends EventEmitter {
  readonly nome: string;
  readonly ip: string;
  readonly snConfigurado: string | null;
  readonly equipamento: EquipamentoFacialTopdata;
  private readonly intervaloVidaMs: number;
  private readonly silencioMaximoMs: number;
  private readonly timeoutOrdemMs: number;

  private ws: WebSocket | null = null;
  private registro: RegistroLeitor | null = null;
  private vistoEm: Date | null = null;
  private desconectadoEm: Date | null = null;
  private fila: Promise<unknown> = Promise.resolve();
  private pendente: Pendente | null = null;
  private timerVida: NodeJS.Timeout | null = null;
  private ultimoPong = 0;

  constructor(equipamento: EquipamentoFacialTopdata, opcoes: OpcoesLeitor = {}) {
    super();
    this.equipamento = equipamento;
    this.nome = equipamento.nome;
    this.ip = equipamento.ip;
    this.snConfigurado = equipamento.sn?.trim() || null;
    this.intervaloVidaMs = opcoes.intervaloVidaMs ?? 30_000;
    this.silencioMaximoMs = opcoes.silencioMaximoMs ?? 90_000;
    this.timeoutOrdemMs = opcoes.timeoutOrdemMs ?? 10_000;
  }

  get conectado(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** sn de quem está conectado, ou o do config. */
  sn(): string | null {
    return this.registro?.sn ?? this.snConfigurado;
  }

  estado(): EstadoLeitor {
    return {
      nome: this.nome,
      conectado: this.conectado,
      sn: this.sn(),
      modelo: this.registro?.modelo ?? null,
      firmware: this.registro?.firmware ?? null,
      vistoEm: this.vistoEm,
      desconectadoEm: this.desconectadoEm,
    };
  }

  /** Chamado pelo servidor depois do `reg`. Responde o `reg` e assume a conexão. */
  aceitar(ws: WebSocket, registro: RegistroLeitor): void {
    const anterior = this.ws;
    this.ws = ws;
    this.registro = registro;
    // O leitor que reconecta substitui a conexão anterior.
    if (anterior && anterior !== ws) anterior.terminate();
    this.cancelarPendente(new Error("o leitor reconectou"));
    this.vistoEm = new Date();
    this.ultimoPong = Date.now();
    this.responder(respostaReg());

    ws.on("message", (dados, binario) => {
      if (this.ws !== ws || binario) return;
      this.vistoEm = new Date();
      this.tratar(dados.toString());
    });
    ws.on("pong", () => {
      if (this.ws !== ws) return;
      this.ultimoPong = Date.now();
      this.vistoEm = new Date();
    });
    ws.on("error", (err) => logger.warn({ leitor: this.nome, err: err.message }, "Erro na conexão com o leitor facial Topdata"));
    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.pararVida();
      this.cancelarPendente(new Error(`O leitor "${this.nome}" desconectou antes de responder.`));
      this.desconectadoEm = new Date();
      logger.warn({ leitor: this.nome }, "Leitor facial Topdata desconectado");
      this.emit("desconectado");
    });

    this.iniciarVida(ws);
    logger.info(
      { leitor: this.nome, sn: registro.sn, modelo: registro.modelo, firmware: registro.firmware },
      "Leitor facial Topdata conectado"
    );
    this.emit("conectado");
  }

  parar(): void {
    this.pararVida();
    this.cancelarPendente(new Error("Gateway encerrando."));
    this.ws?.terminate();
    this.ws = null;
  }

  /** Manda uma resposta (ao `reg`, ao `sendlog`). Fora da fila: o leitor está esperando. */
  responder(texto: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(texto, (err) => {
      if (err) logger.warn({ leitor: this.nome, err: err.message }, "Falha ao responder ao leitor facial");
    });
    return true;
  }

  /**
   * Manda uma ordem e espera a resposta com o mesmo `ret`. Uma de cada vez.
   * Leitor desconectado recusa na hora: quem pediu precisa saber.
   */
  ordem(ordem: Record<string, unknown>): Promise<RespostaLeitor> {
    const executar = () =>
      new Promise<RespostaLeitor>((resolver, rejeitar) => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          rejeitar(new Error(`O leitor "${this.nome}" não está conectado ao Gateway agora.`));
          return;
        }
        const ret = String(ordem.cmd).toLowerCase();
        const timer = setTimeout(() => {
          if (this.pendente?.timer === timer) this.pendente = null;
          rejeitar(new Error(`O leitor "${this.nome}" não respondeu a "${ret}" a tempo.`));
        }, this.timeoutOrdemMs);
        timer.unref?.();
        this.pendente = { ret, resolver, rejeitar, timer };
        ws.send(JSON.stringify(ordem), (err) => {
          if (err && this.pendente?.timer === timer) {
            clearTimeout(timer);
            this.pendente = null;
            rejeitar(new Error(`Falha ao enviar ao leitor "${this.nome}": ${err.message}`));
          }
        });
      });
    const proxima = this.fila.then(executar, executar);
    this.fila = proxima.catch(() => undefined);
    return proxima;
  }

  private tratar(bruto: string): void {
    const msg = interpretarMensagem(bruto);
    switch (msg.tipo) {
      case "resposta": {
        const p = this.pendente;
        if (p && p.ret === msg.ret) {
          clearTimeout(p.timer);
          this.pendente = null;
          p.resolver({ sucesso: msg.sucesso, motivo: msg.motivo, mensagem: msg.mensagem, dados: msg.dados });
        }
        return;
      }
      case "sendlog":
        this.emit("sendlog", msg.registros satisfies RegistroAcesso[]);
        return;
      case "senduser":
        // Cadastro feito no menu do próprio leitor, por fora do ARKE: sem o
        // número no ARKE, a pessoa não é reconhecida como aluno, e sem a
        // autorização registrada o rosto dela não devia estar ali.
        this.responder(respostaSenduser());
        logger.warn(
          { leitor: this.nome, enrollid: msg.enrollid },
          "Alguém foi cadastrado direto no menu do leitor facial — cadastre pela ficha do aluno no ARKE"
        );
        return;
      case "reg":
        // O mesmo leitor se apresentando de novo na mesma conexão.
        this.registro = msg.registro;
        this.responder(respostaReg());
        return;
      default:
        return;
    }
  }

  private cancelarPendente(erro: Error): void {
    const p = this.pendente;
    if (!p) return;
    clearTimeout(p.timer);
    this.pendente = null;
    p.rejeitar(erro);
  }

  /**
   * Ping do WebSocket. A página da Topdata diz que o "KeepAlive" do menu do
   * leitor não vale para o WebSocket, então o sinal de vida é nosso. A
   * folga é grande (90 s) de propósito: derrubar um leitor saudável deixa a
   * catraca sem decisão até ele voltar.
   */
  private iniciarVida(ws: WebSocket): void {
    this.pararVida();
    this.timerVida = setInterval(() => {
      if (this.ws !== ws) return;
      if (Date.now() - this.ultimoPong > this.silencioMaximoMs) {
        logger.warn({ leitor: this.nome }, "Leitor facial parou de responder — fechando a conexão");
        ws.terminate();
        return;
      }
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
  }
}

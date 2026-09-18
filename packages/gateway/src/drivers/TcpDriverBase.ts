import net from "node:net";
import { EventEmitter } from "node:events";
import { logger } from "../logger";

/**
 * Conexão TCP genérica e reconectável ao IP/porta da catraca — a parte do
 * driver que é igual para qualquer fabricante. O que muda entre
 * Control iD/Henry/Topdata/Dimep é como interpretar os bytes recebidos
 * (`onData`) e como montar os comandos de liberação/bloqueio
 * (`enviar`) — isso é implementado em cada *Driver.ts concreto.
 */
export class TcpDriverBase extends EventEmitter {
  private socket: net.Socket | null = null;
  private reconectando = false;
  private readonly reconectarAposMs = 5000;

  constructor(
    private readonly host: string,
    private readonly porta: number
  ) {
    super();
  }

  conectar(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;

      const aoConectar = () => {
        socket.off("error", aoFalharPrimeiraConexao);
        logger.info({ host: this.host, porta: this.porta }, "Conectado à catraca via TCP");
        resolve();
      };
      const aoFalharPrimeiraConexao = (err: Error) => {
        socket.off("connect", aoConectar);
        reject(err);
      };

      socket.once("connect", aoConectar);
      socket.once("error", aoFalharPrimeiraConexao);

      socket.on("data", (chunk: Buffer) => this.emit("data", chunk));
      socket.on("close", () => this.agendarReconexao());
      socket.on("error", (err: Error) => logger.warn({ err: err.message }, "Erro na conexão com a catraca"));

      socket.connect(this.porta, this.host);
    });
  }

  private agendarReconexao(): void {
    if (this.reconectando) return;
    this.reconectando = true;
    logger.warn(
      { host: this.host, porta: this.porta, tentaNovamenteEmMs: this.reconectarAposMs },
      "Conexão com a catraca caiu — tentando reconectar"
    );
    setTimeout(() => {
      this.reconectando = false;
      this.conectar().catch(() => this.agendarReconexao());
    }, this.reconectarAposMs);
  }

  enviar(dados: Buffer): void {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("Sem conexão ativa com a catraca.");
    }
    this.socket.write(dados);
  }

  desconectar(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve();
      this.socket.end(() => resolve());
    });
  }
}

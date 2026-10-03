import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../../../logger";
import { CHAVE_API_LITENET3 } from "./protocolo";

/**
 * Onde as placas LiteNet3 discam. Um servidor só para todas as placas da
 * academia: cada uma se apresenta pelo cabeçalho `Serial`, e o servidor a
 * entrega à placa configurada com aquele número.
 *
 * Placa que não está no config.json é recusada na porta (403), antes de
 * abrir o WebSocket. A chave `x-api-key` é fixa no firmware e pública, então
 * ela sozinha não basta: sem conferir o serial, qualquer aparelho da rede da
 * academia se apresentaria como catraca.
 */

export interface DestinoLiteNet3 {
  /** Serial configurado, ou o aprendido pela descoberta. */
  serial(): string | null;
  /** IP configurado da placa: vale quando o serial ainda não é conhecido. */
  readonly ip: string;
  aceitar(ws: WebSocket, serial: string): void;
}

/** "::ffff:192.168.0.10" e "192.168.0.10" são o mesmo endereço. */
function ipSemPrefixo(ip: string | undefined): string {
  return (ip ?? "").replace(/^::ffff:/, "");
}

export class ServidorLiteNet3 {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;
  private readonly destinos: DestinoLiteNet3[] = [];

  constructor(
    private readonly host: string,
    readonly porta: number
  ) {
    // O pacote oficial aceita mensagens de até 1 MB; acima disso, a conexão cai.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http = http.createServer((_req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Esta porta recebe as placas Toletus LiteNet3.");
    });
    this.http.on("upgrade", (req, socket, cabeca) => this.recepcionar(req, socket, cabeca));
  }

  registrar(destino: DestinoLiteNet3): void {
    this.destinos.push(destino);
  }

  async iniciar(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.porta, this.host, () => {
        this.http.off("error", reject);
        resolve();
      });
    });
    logger.info({ host: this.host, porta: this.porta }, "Servidor das placas Toletus LiteNet3 no ar");
  }

  async parar(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Porta efetiva (os testes pedem a porta 0 e o sistema escolhe). */
  portaEmUso(): number {
    const endereco = this.http.address();
    return typeof endereco === "object" && endereco ? endereco.port : this.porta;
  }

  private recusar(socket: Duplex, status: string, motivo: string, ip: string): void {
    logger.warn({ ip, motivo }, "Conexão de placa LiteNet3 recusada");
    socket.write(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private recepcionar(req: http.IncomingMessage, socket: Duplex, cabeca: Buffer): void {
    const ip = ipSemPrefixo(req.socket.remoteAddress);
    const chave = String(req.headers["x-api-key"] ?? "");
    const serial = String(req.headers["serial"] ?? "").trim();
    if (chave !== CHAVE_API_LITENET3) return this.recusar(socket, "403 Forbidden", "chave x-api-key diferente", ip);
    if (!serial) return this.recusar(socket, "403 Forbidden", "sem o cabeçalho Serial", ip);

    // Pelo serial, que é quem a placa é. O IP só vale para a placa cujo
    // serial ainda não se conhece (a descoberta não respondeu ainda).
    const destino =
      this.destinos.find((d) => d.serial() === serial) ??
      this.destinos.find((d) => d.serial() === null && ipSemPrefixo(d.ip) === ip);
    if (!destino) return this.recusar(socket, "403 Forbidden", `placa ${serial} não está no config.json`, ip);

    this.wss.handleUpgrade(req, socket, cabeca, (ws) => destino.aceitar(ws, serial));
  }
}

import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../../logger";
import type { LeitorFacialTopdata } from "./leitor";
import { interpretarMensagem, respostaRegRecusado, type RegistroLeitor } from "./protocolo";

/**
 * Onde os leitores faciais da Topdata discam (porta 7792 por padrão, a do
 * menu do leitor). Um servidor para todos os leitores da academia.
 *
 * O leitor se apresenta pelo `reg`, com o número de série. Leitor que não
 * está no config.json recebe "não" e a conexão fecha: sem isso, qualquer
 * aparelho da rede da academia se apresentaria como catraca e receberia
 * as ordens de cadastro, que levam os números dos alunos.
 */

/** Quanto esperar o `reg` depois de a conexão abrir. */
const ESPERA_REG_MS = 30_000;

function ipSemPrefixo(ip: string | undefined): string {
  return (ip ?? "").replace(/^::ffff:/, "");
}

export class ServidorFacialTopdata {
  private readonly http: http.Server;
  private readonly wss: WebSocketServer;

  constructor(
    private readonly host: string,
    private readonly porta: number,
    private readonly leitores: LeitorFacialTopdata[]
  ) {
    // A foto de cadastro (backupnum 50) tem até ~150 KB em base64; o limite
    // de 2 MB é folga para ela, sem deixar mensagem sem tamanho entrar.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
    this.http = http.createServer((_req, res) => {
      res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Esta porta recebe os leitores faciais Topdata.");
    });
    // O leitor disca para o endereço do menu, com o caminho que o firmware
    // escolher: aceitamos qualquer caminho.
    this.http.on("upgrade", (req, socket, cabeca) => {
      this.wss.handleUpgrade(req, socket, cabeca, (ws) => this.receber(ws, ipSemPrefixo(req.socket.remoteAddress)));
    });
  }

  async iniciar(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.porta, this.host, () => {
        this.http.off("error", reject);
        resolve();
      });
    });
    logger.info({ host: this.host, porta: this.portaEmUso() }, "Servidor dos leitores faciais Topdata no ar");
  }

  async parar(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  portaEmUso(): number {
    const endereco = this.http.address();
    return typeof endereco === "object" && endereco ? endereco.port : this.porta;
  }

  private escolher(registro: RegistroLeitor, ip: string): LeitorFacialTopdata | null {
    return (
      this.leitores.find((l) => l.snConfigurado === registro.sn) ??
      this.leitores.find((l) => l.snConfigurado === null && ipSemPrefixo(l.ip) === ip) ??
      null
    );
  }

  private receber(ws: WebSocket, ip: string): void {
    const prazo = setTimeout(() => {
      logger.warn({ ip }, "Conexão no servidor facial sem o reg do leitor — fechando");
      ws.terminate();
    }, ESPERA_REG_MS);
    prazo.unref?.();

    const aoReceber = (dados: Buffer, binario: boolean) => {
      if (binario) return;
      const msg = interpretarMensagem(dados.toString());
      if (msg.tipo !== "reg") return;
      clearTimeout(prazo);
      ws.off("message", aoReceber);
      const leitor = this.escolher(msg.registro, ip);
      if (!leitor) {
        logger.warn(
          { ip, sn: msg.registro.sn, modelo: msg.registro.modelo },
          "Leitor facial que não está no config.json tentou se conectar — inclua em topdata_faciais para ele funcionar"
        );
        ws.send(respostaRegRecusado(), () => ws.close(1008, "leitor não configurado"));
        return;
      }
      leitor.aceitar(ws, msg.registro);
    };
    ws.on("message", aoReceber);
    ws.on("error", () => {});
  }
}

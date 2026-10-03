import http from "node:http";
import { WebSocket } from "ws";

/**
 * Leitor facial da Topdata de mentira, escrito a partir da página "Comandos
 * do Leitor Facial" do portal de integradores, sem importar o código do
 * Gateway. Disca para o servidor por WebSocket, apresenta-se com o `reg`,
 * responde às ordens e manda os acessos que o teste pedir.
 *
 * Também serve a API HTTP do leitor (POST /api), para a abertura remota e
 * as configurações de foto.
 */
export class LeitorFacialFalso {
  ordens: Record<string, unknown>[] = [];
  respostas: Record<string, unknown>[] = [];
  chamadasHttp: Record<string, unknown>[] = [];
  regAceito: boolean | null = null;
  /** Usuários cadastrados no leitor, por enrollid. */
  usuarios = new Map<number, Record<string, unknown>>();
  /** false: as ordens ficam sem resposta, como um leitor travado. */
  responderOrdens = true;
  senhaHttp = "1234";
  private ws: WebSocket | null = null;
  private apiHttp: http.Server | null = null;
  portaHttp = 0;

  constructor(readonly sn = "AYSH01090913") {}

  async discar(porta: number): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}/pub/chat`);
    this.ws = ws;
    ws.on("message", (dados) => {
      const msg = JSON.parse(dados.toString()) as Record<string, unknown>;
      if (msg.ret) {
        this.respostas.push(msg);
        if (msg.ret === "reg") this.regAceito = msg.result === true;
        return;
      }
      this.ordens.push(msg);
      if (this.responderOrdens) this.responder(msg);
    });
    ws.on("error", () => {});
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    this.enviar({
      cmd: "reg",
      sn: this.sn,
      devinfo: { modelname: "AiFace", usersize: 15000, facesize: 5000, useduser: this.usuarios.size, usedface: 0, firmware: "ai518_fp26v_v1.27", mac: "00-00-00-00-00-00" },
    });
  }

  conectado(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  derrubar(): void {
    this.ws?.terminate();
    this.ws = null;
  }

  enviar(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Um rosto reconhecido agora. */
  rosto(enrollid: number, hora = this.agora()): void {
    this.enviar({ cmd: "sendlog", sn: this.sn, count: 1, logindex: 0, record: [{ enrollid, name: "Aluno", time: hora, mode: 8, inout: 0, event: 0 }] });
  }

  /** Rosto desconhecido, com a foto que o leitor manda junto. */
  desconhecido(): void {
    this.enviar({
      cmd: "sendlog",
      sn: this.sn,
      count: 1,
      logindex: 124,
      record: [{ enrollid: 99999999, name: "", time: this.agora(), mode: 1, inout: 0, event: 2, image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD" }],
    });
  }

  /** Registros guardados enquanto o leitor estava sem servidor. */
  historico(): void {
    this.enviar({
      cmd: "sendlog",
      sn: this.sn,
      count: 2,
      logindex: 7,
      record: [
        { enrollid: 5, name: "Aluno", time: "2026-01-10 08:00:00", mode: 8, inout: 0, event: 0 },
        { enrollid: 6, name: "Aluno", time: "2026-01-10 08:01:00", mode: 8, inout: 0, event: 0 },
      ],
    });
  }

  /** Cadastro feito no menu do próprio leitor. */
  cadastroNoMenu(enrollid: number): void {
    this.enviar({ cmd: "senduser", sn: this.sn, enrollid, name: "Fulano", backupnum: 0, admin: 0, record: "0" });
  }

  respostasDe(ret: string): Record<string, unknown>[] {
    return this.respostas.filter((r) => r.ret === ret);
  }

  ordensDe(cmd: string): Record<string, unknown>[] {
    return this.ordens.filter((o) => o.cmd === cmd);
  }

  private agora(): string {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  private responder(o: Record<string, unknown>): void {
    const cmd = String(o.cmd);
    if (cmd === "setuserinfo") {
      this.usuarios.set(Number(o.enrollid), o);
      this.enviar({ ret: "setuserinfo", sn: this.sn, result: true });
    } else if (cmd === "deleteuser") {
      const existia = this.usuarios.delete(Number(o.enrollid));
      this.enviar(existia ? { ret: "deleteuser", result: true } : { ret: "deleteuser", result: false, reason: 1, msg: "can not find the user" });
    } else if (cmd === "setdevinfo") {
      this.enviar({ ret: "setdevinfo", result: true });
    }
  }

  /** A API HTTP do leitor, numa porta livre. */
  async abrirApiHttp(): Promise<number> {
    this.apiHttp = http.createServer((req, res) => {
      let corpo = "";
      req.on("data", (c) => (corpo += c));
      req.on("end", () => {
        const pedido = JSON.parse(corpo || "{}") as Record<string, unknown>;
        this.chamadasHttp.push(pedido);
        res.setHeader("Content-Type", "application/json");
        if (pedido.password !== this.senhaHttp) {
          res.end(JSON.stringify({ ret: pedido.cmd, sn: this.sn, result: false, reason: 2 }));
          return;
        }
        res.end(JSON.stringify({ ret: pedido.cmd, sn: this.sn, result: true }));
      });
    });
    await new Promise<void>((resolve) => this.apiHttp!.listen(0, "127.0.0.1", resolve));
    this.portaHttp = (this.apiHttp.address() as { port: number }).port;
    return this.portaHttp;
  }

  async fechar(): Promise<void> {
    this.ws?.terminate();
    if (this.apiHttp) await new Promise<void>((resolve) => this.apiHttp!.close(() => resolve()));
  }
}

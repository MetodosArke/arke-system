import net from "node:net";
import { COMANDO, MontadorDePacotes, montarPacote, textoParaDados, type PacoteToletus } from "../../src/conectores/toletus/protocolo";

/**
 * Placa Toletus LiteNet2 de mentira: um servidor TCP de verdade, numa
 * porta livre, que fala o protocolo do manual. Guarda os pacotes que
 * recebe, responde às consultas como a placa e manda as notificações que o
 * teste pedir — leitura de cartão, passagem, tempo esgotado.
 *
 * `responderConsultas = false` simula a placa que trava calada: a conexão
 * fica aberta, mas nada volta.
 */
export class PlacaToletusFalsa {
  recebidos: PacoteToletus[] = [];
  conexoes = 0;
  responderConsultas = true;
  private servidor: net.Server;
  private socket: net.Socket | null = null;
  porta = 0;

  constructor() {
    this.servidor = net.createServer((socket) => {
      this.conexoes++;
      this.socket = socket;
      const montador = new MontadorDePacotes();
      socket.on("data", (pedaco) => {
        for (const p of montador.empurrar(pedaco)) {
          this.recebidos.push(p);
          if (this.responderConsultas) this.responder(p);
        }
      });
      socket.on("error", () => {});
    });
  }

  async abrir(): Promise<number> {
    await new Promise<void>((resolve) => this.servidor.listen(0, "127.0.0.1", resolve));
    this.porta = (this.servidor.address() as net.AddressInfo).port;
    return this.porta;
  }

  async fechar(): Promise<void> {
    this.socket?.destroy();
    await new Promise<void>((resolve) => this.servidor.close(() => resolve()));
  }

  /** Derruba a conexão atual, como um cabo arrancado do lado da placa. */
  derrubar(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  conectada(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  enviarBruto(bytes: Buffer): void {
    this.socket?.write(bytes);
  }

  cartao(numero: string): void {
    this.enviarBruto(montarPacote(COMANDO.ID_RFID, textoParaDados(numero)));
  }

  teclado(digitos: string): void {
    this.enviarBruto(montarPacote(COMANDO.ID_TECLADO, textoParaDados(digitos)));
  }

  biometria(usuario: number): void {
    const dados = Buffer.alloc(16);
    dados.writeUInt16LE(usuario, 0);
    this.enviarBruto(montarPacote(COMANDO.ID_BIOMETRIA, dados));
  }

  passagem(direcao: 1 | 2, total = 1): void {
    const dados = Buffer.alloc(16);
    dados[0] = direcao;
    dados.writeUInt32LE(total, 1);
    this.enviarBruto(montarPacote(COMANDO.PASSAGEM, dados));
  }

  tempoEsgotado(): void {
    this.enviarBruto(montarPacote(COMANDO.TEMPO_ESGOTADO));
  }

  /** Comandos recebidos, por id, na ordem. */
  comandos(): number[] {
    return this.recebidos.map((p) => p.comando);
  }

  /** Texto do último pacote recebido com aquele comando. */
  textoDo(comando: number): string | null {
    const p = [...this.recebidos].reverse().find((r) => r.comando === comando);
    if (!p) return null;
    const fim = p.dados.indexOf(0);
    return p.dados.subarray(0, fim === -1 ? 16 : fim).toString("ascii");
  }

  private responder(p: PacoteToletus): void {
    const dados = Buffer.alloc(16);
    if (p.comando === COMANDO.CONSULTA_ID) dados.writeUInt16LE(12, 0);
    else if (p.comando === COMANDO.CONSULTA_FIRMWARE) dados.set([2, 1, 1, 0]);
    else if (p.comando === COMANDO.CONSULTA_SERIAL) dados.writeUInt32LE(123456, 0);
    else return;
    this.enviarBruto(montarPacote(p.comando, dados));
  }
}

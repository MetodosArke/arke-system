import dgram from "node:dgram";
import { WebSocket } from "ws";

/**
 * Placa Toletus LiteNet3 de mentira, por rede de verdade: escuta o UDP da
 * descoberta numa porta livre, e quando recebe o endereço do servidor disca
 * para ele por WebSocket com os cabeçalhos do firmware (`x-api-key` e
 * `Serial`), como o pacote oficial descreve. Guarda as mensagens que
 * recebe e manda as notificações que o teste pedir.
 *
 * Escrita a partir do pacote oficial da Toletus, sem importar o código do
 * Gateway: se os dois concordam, é porque os dois leram o mesmo protocolo.
 */
export class PlacaLiteNet3Falsa {
  recebidas: Record<string, unknown>[] = [];
  udpRecebidas: Record<string, unknown>[] = [];
  conexoes = 0;
  uri: string | null = null;
  /** false simula a placa que trava: a conexão fica aberta, mas o pong não volta. */
  responderPing = true;
  chave = "12345-abcde-67890-fghij";
  private udp = dgram.createSocket("udp4");
  private ws: WebSocket | null = null;
  portaUdp = 0;

  constructor(readonly serial = "00000042") {
    this.udp.on("message", (bruto, origem) => {
      const msg = JSON.parse(bruto.toString()) as Record<string, unknown>;
      this.udpRecebidas.push(msg);
      if (msg.fetch === "discovery") {
        const resposta = {
          fetch: "discovery",
          data: { serial: this.serial, id: 1, alias: "Catraca", serverUri: this.uri, ip: "127.0.0.1", connected: !!this.ws, firmware: "V1.0.1.2", hardware: "V1.0.0" },
        };
        this.udp.send(JSON.stringify(resposta), origem.port, origem.address);
      } else if (msg.update === "server") {
        const dados = msg.data as { serial: string; uri: string };
        if (dados.serial !== this.serial) return;
        this.uri = dados.uri;
        this.udp.send(JSON.stringify({ update: "server", result: "ok" }), origem.port, origem.address);
        // Já discando ou conectada: o anúncio repetido não abre outra conexão.
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) this.discar();
      }
    });
  }

  async abrir(): Promise<number> {
    await new Promise<void>((resolve) => this.udp.bind(0, "127.0.0.1", resolve));
    this.portaUdp = this.udp.address().port;
    return this.portaUdp;
  }

  async fechar(): Promise<void> {
    this.ws?.terminate();
    await new Promise<void>((resolve) => this.udp.close(() => resolve()));
  }

  conectada(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Disca para o servidor anunciado, como a placa faz. */
  discar(): void {
    if (!this.uri) return;
    const ws = new WebSocket(this.uri, {
      headers: { "x-api-key": this.chave, Serial: this.serial },
      autoPong: this.responderPing,
    });
    this.ws = ws;
    ws.on("open", () => this.conexoes++);
    ws.on("message", (dados) => {
      const msg = JSON.parse(dados.toString()) as Record<string, unknown>;
      this.recebidas.push(msg);
      const responder = (r: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(r));
      };
      if (msg.fetch === "factory") {
        responder({ fetch: "factory", data: { serial: this.serial, factory: false, firmware: "V1.0.1.2", hardware: "V1.0.0" } });
      } else if (msg.action) {
        responder({ action: msg.action, result: "ok" });
      }
    });
    ws.on("error", () => {});
  }

  /** Derruba a conexão, como a placa que reinicia. */
  derrubar(): void {
    this.ws?.terminate();
    this.ws = null;
  }

  enviar(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  notificar(tipo: string, dados: Record<string, unknown> = {}): void {
    this.enviar({ notification: tipo, data: { serial: this.serial, ...dados } });
  }

  cartao(code: string): void {
    this.notificar("rfid", { code });
  }

  teclado(code: string): void {
    this.notificar("keypad", { code });
  }

  codigoDeBarras(code: string): void {
    this.notificar("barcode", { code });
  }

  passagem(dados: Record<string, unknown> = { in: 1 }): void {
    this.notificar("passage", dados);
  }

  tempoEsgotado(): void {
    this.notificar("timeout", { release: "In", time: 10000 });
  }

  /** Um pedaço da imagem da digital, como a LiteNet3 com leitor manda. */
  pedacoDeDigital(): void {
    this.notificar("biometrics", { id: 1, len: 8, init: true, package: "AAECAwQFBgc=", finally: false, lenTotal: 16 });
  }

  /** Ações recebidas, na ordem. */
  acoes(): { action: string; data: Record<string, unknown> }[] {
    return this.recebidas.filter((m) => m.action) as { action: string; data: Record<string, unknown> }[];
  }

  liberacoes(): Record<string, unknown>[] {
    return this.acoes()
      .filter((a) => a.action === "litenet3" && a.data?.release)
      .map((a) => a.data);
  }
}

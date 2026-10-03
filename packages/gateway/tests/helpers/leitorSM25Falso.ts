import net from "node:net";
import { COMANDO_SM25, ERRO_SM25, MontadorSM25, PASSO, PREFIXO, TAMANHO_REGISTRO, soma, type PacoteSM25 } from "../../src/conectores/toletus/sm25/protocolo";

/**
 * Leitor de digital SM25 de mentira: um servidor TCP de verdade, numa porta
 * livre, que responde como o manual da CAMA descreve. Guarda as digitais por
 * número, como o leitor guarda.
 *
 * O "dedo" é um número: o mesmo dedo gera sempre o mesmo registro, e é assim
 * que ele percebe a digital repetida (verificação de duplicidade, ligada de
 * fábrica). `dedo = null` é ninguém com o dedo no leitor: o cadastro fica
 * esperando, como no equipamento.
 */
export class LeitorSM25Falso {
  /** Número → registro de 498 bytes. */
  readonly digitais = new Map<number, Buffer>();
  /** Comandos recebidos, na ordem. */
  readonly comandos: number[] = [];
  dedo: number | null = 1;
  /** Quantas leituras ruins antes de uma boa, em cada toque do próximo cadastro. */
  leiturasRuins = 0;
  /** As três leituras não se unem (ERR_GENERALIZE). */
  falharAoUnir = false;
  tempoDoDedo = 5;
  capacidade = 3000;
  /** Atender conexões. false: o leitor some da rede. */
  atender = true;
  /** Responder ao FP Cancel. false: o leitor travado. */
  responderCancelamento = true;
  /** Atraso entre os passos do cadastro, para o teste conseguir agir no meio. */
  passoMs = 5;
  porta = 0;
  private readonly servidor: net.Server;
  private readonly sockets = new Set<net.Socket>();

  constructor() {
    this.servidor = net.createServer((socket) => {
      if (!this.atender) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => {});
      new Conversa(this, socket);
    });
  }

  static registroDoDedo(dedo: number): Buffer {
    const r = Buffer.alloc(TAMANHO_REGISTRO);
    for (let i = 0; i < 496; i++) r[i] = (dedo * 31 + i * 7) & 0xff;
    r.writeUInt16LE(soma(r, 496), 496);
    return r;
  }

  async abrir(): Promise<number> {
    await new Promise<void>((resolve) => this.servidor.listen(0, "127.0.0.1", resolve));
    this.porta = (this.servidor.address() as net.AddressInfo).port;
    return this.porta;
  }

  async fechar(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.servidor.close(() => resolve()));
  }

  conexoesAbertas(): number {
    return this.sockets.size;
  }
}

/** Uma conexão: um comando por vez, como o leitor. */
class Conversa {
  private readonly montador = new MontadorSM25();
  private cadastro: { numero: number; cancelado: boolean } | null = null;
  private gravacaoPendente = false;

  constructor(
    private readonly leitor: LeitorSM25Falso,
    private readonly socket: net.Socket
  ) {
    socket.on("data", (pedaco: Buffer) => {
      for (const p of this.montador.adicionar(pedaco)) this.tratar(p);
    });
  }

  private tratar(p: PacoteSM25): void {
    const l = this.leitor;
    if (p.tipo === "dados_comando" && p.comando === COMANDO_SM25.GRAVAR_REGISTRO && this.gravacaoPendente) {
      this.gravacaoPendente = false;
      const numero = p.dados.readUInt16LE(0);
      const registro = Buffer.from(p.dados.subarray(2, 2 + TAMANHO_REGISTRO));
      if (numero < 1 || numero > l.capacidade) return this.dadosResposta(p.comando, 1, num(ERRO_SM25.NUMERO_INVALIDO));
      if (soma(registro, 496) !== registro.readUInt16LE(496)) return this.dadosResposta(p.comando, 1, num(ERRO_SM25.PARAMETRO_INVALIDO));
      l.digitais.set(numero, registro);
      return this.dadosResposta(p.comando, 0, num(numero));
    }
    if (p.tipo !== "comando") return;
    l.comandos.push(p.comando);
    const parametro = p.dados.length >= 2 ? p.dados.readUInt16LE(0) : 0;
    switch (p.comando) {
      case COMANDO_SM25.TESTAR_CONEXAO:
        return this.resposta(p.comando, 0);
      case COMANDO_SM25.TEMPO_DO_DEDO:
        return this.resposta(p.comando, 0, num(l.tempoDoDedo));
      case COMANDO_SM25.DEFINIR_TEMPO_DO_DEDO:
        if (parametro > 60) return this.resposta(p.comando, 1, num(ERRO_SM25.TEMPO_INVALIDO));
        l.tempoDoDedo = parametro;
        return this.resposta(p.comando, 0, num(parametro));
      case COMANDO_SM25.SITUACAO_DO_NUMERO:
        if (parametro < 1 || parametro > l.capacidade) return this.resposta(p.comando, 1, num(ERRO_SM25.NUMERO_INVALIDO));
        return this.resposta(p.comando, 0, num(l.digitais.has(parametro) ? 1 : 0));
      case COMANDO_SM25.APAGAR:
        if (parametro < 1 || parametro > l.capacidade) return this.resposta(p.comando, 1, num(ERRO_SM25.NUMERO_INVALIDO));
        if (!l.digitais.delete(parametro)) return this.resposta(p.comando, 1, num(ERRO_SM25.NUMERO_VAZIO));
        return this.resposta(p.comando, 0, num(parametro));
      case COMANDO_SM25.LER_REGISTRO: {
        const r = l.digitais.get(parametro);
        if (!r) return this.resposta(p.comando, 1, num(ERRO_SM25.NUMERO_VAZIO));
        this.resposta(p.comando, 0, num(TAMANHO_REGISTRO + 2));
        const d = Buffer.alloc(2 + TAMANHO_REGISTRO);
        d.writeUInt16LE(parametro, 0);
        r.copy(d, 2);
        return this.dadosResposta(p.comando, 0, d);
      }
      case COMANDO_SM25.GRAVAR_REGISTRO:
        if (parametro !== TAMANHO_REGISTRO) return this.resposta(p.comando, 1, num(ERRO_SM25.PARAMETRO_INVALIDO));
        this.gravacaoPendente = true;
        return this.resposta(p.comando, 0, num(0));
      case COMANDO_SM25.CANCELAR:
        if (!l.responderCancelamento) return;
        if (this.cadastro && !this.cadastro.cancelado) {
          this.cadastro.cancelado = true;
          this.resposta(COMANDO_SM25.CADASTRAR, 1, num(ERRO_SM25.CANCELADO));
        }
        return this.resposta(p.comando, 0);
      case COMANDO_SM25.CADASTRAR:
        void this.cadastrar(parametro);
        return;
      default:
        return this.resposta(COMANDO_SM25.COMANDO_INCORRETO, 0);
    }
  }

  private async cadastrar(numero: number): Promise<void> {
    const l = this.leitor;
    const c = COMANDO_SM25.CADASTRAR;
    if (numero < 1 || numero > l.capacidade) return this.resposta(c, 1, num(ERRO_SM25.NUMERO_INVALIDO));
    if (l.digitais.has(numero)) return this.resposta(c, 1, num(ERRO_SM25.NUMERO_OCUPADO));
    this.cadastro = { numero, cancelado: false };
    const toques = [PASSO.PRIMEIRO_TOQUE, PASSO.SEGUNDO_TOQUE, PASSO.TERCEIRO_TOQUE];
    for (const toque of toques) {
      this.resposta(c, 0, num(toque));
      // Espera o dedo, como o leitor: sem dedo, fica aqui até o cancelamento.
      while (l.dedo === null) {
        await esperar(5);
        if (this.cadastro.cancelado || this.socket.destroyed) return;
      }
      await esperar(l.passoMs);
      if (this.cadastro.cancelado || this.socket.destroyed) return;
      for (let i = 0; i < l.leiturasRuins; i++) this.resposta(c, 1, num(ERRO_SM25.QUALIDADE_RUIM));
      this.resposta(c, 0, num(PASSO.TIRAR_O_DEDO));
    }
    l.leiturasRuins = 0;
    if (l.falharAoUnir) return this.resposta(c, 1, num(ERRO_SM25.FALHA_AO_UNIR));
    const registro = LeitorSM25Falso.registroDoDedo(l.dedo!);
    for (const [outro, r] of l.digitais) {
      if (r.equals(registro)) {
        const d = Buffer.alloc(4);
        d.writeUInt16LE(ERRO_SM25.DIGITAL_REPETIDA, 0);
        d.writeUInt16LE(outro, 2);
        return this.resposta(c, 1, d, 6);
      }
    }
    l.digitais.set(numero, registro);
    this.cadastro = null;
    this.resposta(c, 0, num(numero), 6);
  }

  private resposta(comando: number, ret: number, dados: Buffer = Buffer.alloc(0), len = 2 + dados.length): void {
    if (this.socket.destroyed) return;
    const b = Buffer.alloc(24);
    b.writeUInt16LE(PREFIXO.RESPOSTA, 0);
    b.writeUInt16LE(comando, 2);
    b.writeUInt16LE(Math.max(len, 4), 4);
    b.writeUInt16LE(ret, 6);
    dados.copy(b, 8, 0, 14);
    b.writeUInt16LE(soma(b, 22), 22);
    this.socket.write(b);
  }

  private dadosResposta(comando: number, ret: number, dados: Buffer): void {
    if (this.socket.destroyed) return;
    const n = 2 + dados.length;
    const b = Buffer.alloc(n + 8);
    b.writeUInt16LE(PREFIXO.DADOS_RESPOSTA, 0);
    b.writeUInt16LE(comando, 2);
    b.writeUInt16LE(n, 4);
    b.writeUInt16LE(ret, 6);
    dados.copy(b, 8);
    b.writeUInt16LE(soma(b, b.length - 2), b.length - 2);
    this.socket.write(b);
  }
}

function num(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  return b;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

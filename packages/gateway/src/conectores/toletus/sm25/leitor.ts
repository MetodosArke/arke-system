import net from "node:net";
import {
  COMANDO_SM25,
  ERRO_SM25,
  MontadorSM25,
  NUMERO_OCUPADO,
  PASSO,
  PORTA_LEITOR_SM25,
  TAMANHO_REGISTRO,
  dadosDeGravacao,
  mensagemDoErroSM25,
  montarComando,
  montarDadosDoComando,
  registroValido,
  valorDe,
  type PacoteSM25,
} from "./protocolo";

/**
 * Uma conversa com o leitor de digital SM25 de uma placa Toletus.
 *
 * A conexão abre para uma operação (cadastrar, apagar, copiar) e fecha no
 * fim, como o Toletus Hub faz: a placa usa o mesmo leitor para reconhecer
 * quem chega à catraca, e uma conexão parada na porta 7879 não tem por que
 * ficar. O manual pede um comando por vez, esperando a resposta antes do
 * próximo (§4.1) — é o que `pedir` garante.
 */

export class ErroSM25 extends Error {
  constructor(
    readonly codigo: number,
    /** Na digital repetida: o número em que ela já está, quando o leitor informa. */
    readonly repetidaEm: number | null = null
  ) {
    super(mensagemDoErroSM25(codigo));
    this.name = "ErroSM25";
  }
}

export interface OpcoesSessaoSM25 {
  ip: string;
  porta?: number;
  conectarTimeoutMs?: number;
  /** Quanto esperar a resposta de um comando que não depende do dedo. */
  respostaTimeoutMs?: number;
}

/** O que o cadastro conta enquanto acontece: para o display da catraca e o log. */
export type PassoCadastro = { tipo: "toque"; vez: 1 | 2 | 3 } | { tipo: "tirar_o_dedo" } | { tipo: "qualidade_ruim" };

type Espera = {
  aceita: (p: PacoteSM25) => boolean;
  resolver: (p: PacoteSM25) => void;
  rejeitar: (e: Error) => void;
  timer: NodeJS.Timeout;
};

export class SessaoSM25 {
  private readonly montador = new MontadorSM25();
  private recebidos: PacoteSM25[] = [];
  private espera: Espera | null = null;
  private encerrada: Error | null = null;

  private constructor(
    private readonly socket: net.Socket,
    private readonly respostaTimeoutMs: number
  ) {
    socket.on("data", (pedaco: Buffer) => {
      for (const p of this.montador.adicionar(pedaco)) this.receber(p);
    });
    socket.on("close", () => this.encerrar(new Error("o leitor de digital fechou a conexão")));
    socket.on("error", (err) => this.encerrar(new Error(`falha na conexão com o leitor de digital: ${err.message}`)));
  }

  static abrir(opcoes: OpcoesSessaoSM25): Promise<SessaoSM25> {
    const porta = opcoes.porta ?? PORTA_LEITOR_SM25;
    const conectarTimeoutMs = opcoes.conectarTimeoutMs ?? 5_000;
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: opcoes.ip, port: porta });
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`o leitor de digital em ${opcoes.ip}:${porta} não atendeu`));
      }, conectarTimeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(new SessaoSM25(socket, opcoes.respostaTimeoutMs ?? 5_000));
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`o leitor de digital em ${opcoes.ip}:${porta} não atendeu (${err.message})`));
      });
    });
  }

  fechar(): void {
    this.encerrar(new Error("sessão encerrada"));
    this.socket.destroy();
  }

  /** Confere que é um SM25 do outro lado (§5.3.36). */
  async testar(): Promise<void> {
    const r = await this.pedir(COMANDO_SM25.TESTAR_CONEXAO);
    if (r.ret !== 0) throw new ErroSM25(valorDe(r));
  }

  async tempoDoDedo(): Promise<number> {
    return valorDe(await this.pedir(COMANDO_SM25.TEMPO_DO_DEDO));
  }

  async definirTempoDoDedo(segundos: number): Promise<void> {
    const r = await this.pedir(COMANDO_SM25.DEFINIR_TEMPO_DO_DEDO, segundos);
    if (r.ret !== 0) throw new ErroSM25(valorDe(r));
  }

  async ocupado(numero: number): Promise<boolean> {
    const r = await this.pedir(COMANDO_SM25.SITUACAO_DO_NUMERO, numero);
    if (r.ret !== 0) throw new ErroSM25(valorDe(r));
    return valorDe(r) === NUMERO_OCUPADO;
  }

  /** Apaga a digital do número (§5.3.5). Devolve false se não havia digital ali — o que, para quem apaga, é sucesso. */
  async apagar(numero: number): Promise<boolean> {
    const r = await this.pedir(COMANDO_SM25.APAGAR, numero);
    if (r.ret === 0) return true;
    if (valorDe(r) === ERRO_SM25.NUMERO_VAZIO) return false;
    throw new ErroSM25(valorDe(r));
  }

  /**
   * O registro da digital guardada no número (§5.3.10): primeiro a resposta
   * com o tamanho, depois o pacote de dados com o número e o registro. Quem
   * recebe zera o buffer quando terminar.
   */
  async lerRegistro(numero: number): Promise<Buffer> {
    const r = await this.pedir(COMANDO_SM25.LER_REGISTRO, numero);
    if (r.ret !== 0) throw new ErroSM25(valorDe(r));
    const d = await this.aguardar((p) => p.tipo === "dados_resposta" && p.comando === COMANDO_SM25.LER_REGISTRO, this.respostaTimeoutMs);
    try {
      if (d.ret !== 0) throw new ErroSM25(valorDe(d));
      const registro = Buffer.from(d.dados.subarray(2, 2 + TAMANHO_REGISTRO));
      if (!registroValido(registro)) {
        registro.fill(0);
        throw new Error("o leitor devolveu um registro de digital corrompido");
      }
      return registro;
    } finally {
      d.dados.fill(0);
    }
  }

  /**
   * Grava o registro no número (§5.3.11): anuncia o tamanho, espera o
   * leitor aceitar e só então manda o número e o registro — tudo na mesma
   * conexão.
   */
  async gravarRegistro(numero: number, registro: Buffer): Promise<void> {
    if (!registroValido(registro)) throw new Error("registro de digital inválido para gravar");
    const r = await this.pedir(COMANDO_SM25.GRAVAR_REGISTRO, TAMANHO_REGISTRO);
    if (r.ret !== 0) throw new ErroSM25(valorDe(r));
    const dados = dadosDeGravacao(numero, registro);
    const pacote = montarDadosDoComando(COMANDO_SM25.GRAVAR_REGISTRO, dados);
    dados.fill(0);
    try {
      const d = await this.trocar(
        pacote,
        (p) => p.tipo === "dados_resposta" && p.comando === COMANDO_SM25.GRAVAR_REGISTRO,
        this.respostaTimeoutMs
      );
      if (d.ret !== 0) throw new ErroSM25(valorDe(d));
    } finally {
      pacote.fill(0);
    }
  }

  /**
   * Cadastro com o aluno na frente do leitor (§5.3.3): ele põe o mesmo dedo
   * três vezes, o leitor une as leituras e grava no número. Leitura ruim não
   * encerra — o leitor pede de novo. Acabando o prazo, o cadastro é cancelado
   * no leitor (FP Cancel), senão ele ficaria esperando um dedo e a catraca
   * sem reconhecer ninguém.
   */
  async cadastrar(numero: number, opcoes: { prazoMs: number; aoPasso?: (passo: PassoCadastro) => void }): Promise<void> {
    const limite = Date.now() + opcoes.prazoMs;
    const ehDoCadastro = (p: PacoteSM25) => p.tipo === "resposta" && p.comando === COMANDO_SM25.CADASTRAR;
    this.recebidos = [];
    this.escrever(montarComando(COMANDO_SM25.CADASTRAR, numero));
    for (;;) {
      const restante = limite - Date.now();
      let r: PacoteSM25;
      try {
        if (restante <= 0) throw new ErroSM25(ERRO_SM25.TEMPO_ESGOTADO);
        r = await this.aguardar(ehDoCadastro, restante);
      } catch (err) {
        await this.cancelar();
        throw err instanceof ErroSM25 || this.encerrada ? err : new ErroSM25(ERRO_SM25.TEMPO_ESGOTADO);
      }
      const valor = valorDe(r);
      if (r.ret === 0) {
        if (valor === PASSO.PRIMEIRO_TOQUE) opcoes.aoPasso?.({ tipo: "toque", vez: 1 });
        else if (valor === PASSO.SEGUNDO_TOQUE) opcoes.aoPasso?.({ tipo: "toque", vez: 2 });
        else if (valor === PASSO.TERCEIRO_TOQUE) opcoes.aoPasso?.({ tipo: "toque", vez: 3 });
        else if (valor === PASSO.TIRAR_O_DEDO) opcoes.aoPasso?.({ tipo: "tirar_o_dedo" });
        else if (valor === numero) return;
        else throw new Error(`o leitor gravou a digital no número ${valor}, e não no ${numero}`);
        continue;
      }
      if (valor === ERRO_SM25.QUALIDADE_RUIM) {
        opcoes.aoPasso?.({ tipo: "qualidade_ruim" });
        continue;
      }
      // Na digital repetida, o leitor manda 6 bytes: o erro e o número em que ela já está.
      const repetidaEm = valor === ERRO_SM25.DIGITAL_REPETIDA && r.dados.length >= 4 ? r.dados.readUInt16LE(2) || null : null;
      throw new ErroSM25(valor, repetidaEm);
    }
  }

  /**
   * FP Cancel (§5.3.35). Durante um cadastro, o leitor responde duas vezes:
   * o cadastro cancelado e o cancelamento feito. Basta o segundo.
   */
  async cancelar(): Promise<void> {
    if (this.encerrada) return;
    try {
      await this.pedir(COMANDO_SM25.CANCELAR);
    } catch {
      // Sem resposta, a conexão fecha em seguida e o leitor volta sozinho.
    }
  }

  private async pedir(comando: number, parametro?: number): Promise<PacoteSM25> {
    return this.trocar(
      montarComando(comando, parametro),
      (p) => p.tipo === "resposta" && p.comando === comando,
      this.respostaTimeoutMs
    );
  }

  private async trocar(pacote: Buffer, aceita: (p: PacoteSM25) => boolean, timeoutMs: number): Promise<PacoteSM25> {
    // O que sobrou de uma troca anterior (o eco de um cancelamento, por
    // exemplo) não pode ser tomado pela resposta desta.
    this.recebidos = [];
    this.escrever(pacote);
    return this.aguardar(aceita, timeoutMs);
  }

  private escrever(pacote: Buffer): void {
    if (this.encerrada) throw this.encerrada;
    this.socket.write(pacote);
  }

  private aguardar(aceita: (p: PacoteSM25) => boolean, timeoutMs: number): Promise<PacoteSM25> {
    if (this.encerrada) return Promise.reject(this.encerrada);
    const i = this.recebidos.findIndex((p) => aceita(p) || p.comando === COMANDO_SM25.COMANDO_INCORRETO);
    if (i >= 0) {
      const p = this.recebidos[i];
      this.recebidos = this.recebidos.slice(i + 1);
      return this.entregar(p);
    }
    return new Promise((resolver, rejeitar) => {
      const timer = setTimeout(() => {
        this.espera = null;
        rejeitar(new Error("o leitor de digital não respondeu"));
      }, timeoutMs);
      this.espera = { aceita, resolver, rejeitar, timer };
    }).then((p) => this.entregar(p as PacoteSM25));
  }

  private entregar(p: PacoteSM25): Promise<PacoteSM25> {
    if (p.comando === COMANDO_SM25.COMANDO_INCORRETO) {
      return Promise.reject(new Error("o leitor de digital não reconheceu o comando (versão de firmware diferente?)"));
    }
    return Promise.resolve(p);
  }

  private receber(p: PacoteSM25): void {
    const e = this.espera;
    if (e && (e.aceita(p) || p.comando === COMANDO_SM25.COMANDO_INCORRETO)) {
      clearTimeout(e.timer);
      this.espera = null;
      e.resolver(p);
      return;
    }
    this.recebidos.push(p);
  }

  private encerrar(err: Error): void {
    if (this.encerrada) return;
    this.encerrada = err;
    this.montador.limpar();
    for (const p of this.recebidos) p.dados.fill(0);
    this.recebidos = [];
    const e = this.espera;
    if (e) {
      clearTimeout(e.timer);
      this.espera = null;
      e.rejeitar(err);
    }
  }
}

import type { GatewayService } from "../../core/gatewayService";
import type { GestaoEquipamentos, ReplicacaoEquipamentos } from "../../equipamentos/controlidGestao";
import { logger } from "../../logger";
import type { TipoComando } from "../../types";
import { ApiHttpFacial } from "./apiHttp";
import { LeitorFacialTopdata, type EquipamentoFacialTopdata, type EstadoLeitor, type OpcoesLeitor } from "./leitor";
import {
  apagarConcluido,
  ehPedidoDeAcesso,
  ordemApagar,
  ordemModo,
  ordemUsuario,
  respostaAcesso,
  respostaRecebido,
  type RegistroAcesso,
} from "./protocolo";
import { ServidorFacialTopdata } from "./servidor";

/**
 * Os leitores faciais da Topdata no Gateway, nos dois papéis que eles têm:
 *
 *   - **decidem** (catracas da linha Easy — Fit Easy, Revolution Easy, Box
 *     Easy): não há placa Inner; o leitor reconhece o rosto, pergunta ao
 *     servidor e aciona a catraca. Aqui a pergunta chega como `sendlog`, e
 *     a resposta é a decisão, pelo mesmo caminho das outras marcas (nuvem,
 *     ou o cache na queda de internet);
 *   - **identificam** (catraca Fit 4 Facial): o leitor reconhece e passa o
 *     número do aluno à placa Inner, que pergunta à ponte de sempre. Aqui o
 *     Gateway só mantém o cadastro dos alunos no leitor.
 *
 * Nos dois, o cadastro mora no leitor: o leitor só reconhece quem estiver
 * cadastrado nele, mesmo no modo online (é a regra da página de comandos).
 *
 * **Giro.** A linha Easy não confirma o giro: o `sendlog` é o único retorno
 * (página "Catraca Easy — existe confirmação de giro físico?"). A presença
 * conta pela liberação, como na Control iD sem o Monitor.
 */

export type FuncaoFacial = "decide" | "identifica";

type Decisor = Pick<GatewayService, "validarCredencial" | "registrarAcessoOffline">;

export interface OpcoesConectorFacial {
  funcao: FuncaoFacial;
  host?: string;
  porta?: number;
  leitor?: OpcoesLeitor;
}

export class ConectorFacialTopdata {
  readonly funcao: FuncaoFacial;
  private readonly leitores: LeitorFacialTopdata[];
  private readonly servidor: ServidorFacialTopdata;
  private readonly apis = new Map<string, ApiHttpFacial>();
  /** Um pedido de acesso por vez em cada leitor: o leitor espera cada resposta. */
  private readonly filas = new Map<string, Promise<void>>();

  constructor(
    private readonly gateway: Decisor,
    equipamentos: EquipamentoFacialTopdata[],
    opcoes: OpcoesConectorFacial
  ) {
    this.funcao = opcoes.funcao;
    this.leitores = equipamentos.map((eq) => {
      const leitor = new LeitorFacialTopdata(eq, opcoes.leitor);
      this.apis.set(eq.nome, new ApiHttpFacial(eq));
      leitor.on("conectado", () => void this.configurar(leitor));
      leitor.on("sendlog", (registros: RegistroAcesso[]) => this.enfileirar(leitor, registros));
      return leitor;
    });
    this.servidor = new ServidorFacialTopdata(opcoes.host ?? "0.0.0.0", opcoes.porta ?? 7792, this.leitores);
  }

  /** A porta ocupada derruba a inicialização: sem ela, nenhum leitor alcança o Gateway. */
  async iniciar(): Promise<void> {
    await this.servidor.iniciar();
  }

  parar(): void {
    for (const l of this.leitores) l.parar();
    void this.servidor.parar();
  }

  porta(): number {
    return this.servidor.portaEmUso();
  }

  estados(): EstadoLeitor[] {
    return this.leitores.map((l) => l.estado());
  }

  nomes(): string[] {
    return this.leitores.map((l) => l.nome);
  }

  leitor(nome?: string | null): LeitorFacialTopdata {
    if (this.leitores.length === 0) throw new Error("Nenhum leitor facial Topdata configurado neste Gateway.");
    if (!nome) return this.leitores[0];
    const l = this.leitores.find((x) => x.nome === nome);
    if (!l) throw new Error(`Leitor "${nome}" não está configurado neste Gateway.`);
    return l;
  }

  todos(): LeitorFacialTopdata[] {
    return [...this.leitores];
  }

  api(nome: string): ApiHttpFacial {
    return this.apis.get(nome)!;
  }

  /**
   * A cada conexão, o modo de verificação vai de novo: é a garantia de que
   * o leitor que decide nega sem o Gateway, e de que o que só identifica não
   * espera por nós. Falha aqui não derruba nada — o leitor continua no modo
   * em que estava, e o log diz.
   */
  private async configurar(leitor: LeitorFacialTopdata): Promise<void> {
    try {
      const r = await leitor.ordem(ordemModo(this.funcao === "decide"));
      if (!r.sucesso) logger.warn({ leitor: leitor.nome }, "O leitor facial recusou a configuração do modo de verificação");
    } catch (err) {
      logger.warn({ leitor: leitor.nome, err: (err as Error).message }, "Não foi possível configurar o modo do leitor facial");
    }
    const api = this.apis.get(leitor.nome);
    if (api?.configurada) {
      try {
        await api.desligarFotos();
      } catch (err) {
        logger.warn({ leitor: leitor.nome, err: (err as Error).message }, "Não foi possível desligar as fotos de acesso no leitor facial");
      }
    }
  }

  private enfileirar(leitor: LeitorFacialTopdata, registros: RegistroAcesso[]): void {
    const anterior = this.filas.get(leitor.nome) ?? Promise.resolve();
    const proxima = anterior
      .then(() => this.tratar(leitor, registros))
      .catch((err) => {
        logger.error({ leitor: leitor.nome, err: (err as Error).message }, "Falha ao tratar o acesso do leitor facial");
        // A resposta é obrigatória: sem ela o leitor fica esperando. Na
        // dúvida, nega — é a regra do ARKE.
        if (this.funcao === "decide") leitor.responder(respostaAcesso(false, "Falha ao conferir. Tente novamente."));
        else leitor.responder(respostaRecebido(false));
      });
    this.filas.set(leitor.nome, proxima);
  }

  private async tratar(leitor: LeitorFacialTopdata, registros: RegistroAcesso[]): Promise<void> {
    if (this.funcao === "identifica") {
      // Quem decide é a placa Inner, pela ponte. Aqui é só aviso.
      leitor.responder(respostaRecebido(false));
      return;
    }

    if (!ehPedidoDeAcesso(registros)) {
      // Registros guardados enquanto o leitor estava sem servidor. No modo
      // "só online" ele negou todos, então não há presença a recuperar.
      leitor.responder(respostaRecebido(true));
      logger.info({ leitor: leitor.nome, registros: registros.length }, "Histórico do leitor facial recebido");
      return;
    }

    const registro = registros[0];
    if (registro.desconhecido || registro.enrollid === null) {
      // Rosto que o leitor não conhece: nem vai à nuvem. A foto que veio
      // junto já foi descartada na leitura da mensagem.
      leitor.responder(respostaAcesso(false, "Aluno não encontrado nesta academia."));
      logger.info({ leitor: leitor.nome }, "Rosto não cadastrado no leitor facial");
      return;
    }

    const credencial = { tipo: "identificador_catraca" as const, valor: String(registro.enrollid) };
    const resultado = await this.gateway.validarCredencial(credencial);
    logger.info(
      { leitor: leitor.nome, modo: registro.modo, liberado: resultado.liberado, offline: resultado.validadoOffline },
      "Decisão de acesso enviada ao leitor facial"
    );
    // Na contingência ninguém gravou nada ainda; sem giro para esperar, a
    // presença conta pela liberação.
    await this.gateway.registrarAcessoOffline(`id:${credencial.valor}`, resultado);
    leitor.responder(respostaAcesso(resultado.liberado, resultado.mensagem));
  }
}

/**
 * O que a nuvem pode pedir aos leitores faciais. Cadastrar e apagar o
 * aluno vão pelo WebSocket, que todo leitor tem. Abrir a catraca usa a API
 * HTTP do leitor, que exige a senha do menu no config.json.
 *
 * O aluno precisa estar em TODOS os leitores da academia, com o mesmo
 * número, para ser reconhecido em qualquer catraca; e sair de todos.
 */
export class GestaoTopdataFacial implements GestaoEquipamentos {
  constructor(private readonly conector: ConectorFacialTopdata) {}

  nomes(): string[] {
    return this.conector.nomes();
  }

  capacidades(): TipoComando[] {
    const caps: TipoComando[] = ["cadastrar_usuario", "apagar_usuario"];
    if (this.conector.todos().some((l) => this.conector.api(l.nome).configurada)) caps.push("liberar_catraca");
    return caps;
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    return this.conector.estados().map((e) => ({
      equipamento: e.nome,
      ok: e.conectado,
      ...(e.conectado ? {} : { erro: "o leitor não está conectado ao Gateway" }),
    }));
  }

  async criarUsuario(userId: number): Promise<{ equipamentos: string[] }> {
    const cartao = this.conector.funcao === "identifica";
    const feitos: string[] = [];
    const falhas: string[] = [];
    for (const leitor of this.conector.todos()) {
      try {
        const r = await leitor.ordem(ordemUsuario(userId, { cartao }));
        if (!r.sucesso) throw new Error(`o leitor recusou o cadastro${r.mensagem ? `: ${r.mensagem}` : ""}`);
        feitos.push(leitor.nome);
      } catch (err) {
        falhas.push(`${leitor.nome}: ${(err as Error).message}`);
      }
    }
    // Faltou algum leitor: o comando falha, e repetir é seguro (o leitor atualiza quem já existe).
    if (falhas.length) throw new Error(`Cadastro incompleto nos leitores faciais — ${falhas.join("; ")}`);
    return { equipamentos: feitos };
  }

  async apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }> {
    const feitos: string[] = [];
    const falhas: string[] = [];
    let apagados = 0;
    for (const leitor of this.conector.todos()) {
      try {
        const r = await leitor.ordem(ordemApagar(userId));
        if (!apagarConcluido(r)) throw new Error(`o leitor recusou a remoção${r.mensagem ? `: ${r.mensagem}` : ""}`);
        if (r.sucesso) apagados++;
        feitos.push(leitor.nome);
      } catch (err) {
        falhas.push(`${leitor.nome}: ${(err as Error).message}`);
      }
    }
    // A LGPD exige a remoção em todos: leitor fora do ar mantém a ordem pendente.
    if (falhas.length) throw new Error(`Remoção incompleta nos leitores faciais — ${falhas.join("; ")}`);
    return { equipamentos: feitos, apagados };
  }

  async liberarCatraca(_sentido: "entrada" | "saida" | "ambos", equipamento?: string | null): Promise<{ equipamento: string }> {
    const leitor = this.conector.leitor(equipamento);
    await this.conector.api(leitor.nome).abrir("Liberado");
    logger.info({ equipamento: leitor.nome }, "Catraca do leitor facial liberada remotamente");
    return { equipamento: leitor.nome };
  }

  private naoSuportado(): never {
    throw new Error("O leitor facial Topdata cadastra o rosto, não digital nem cartão por aqui.");
  }

  async cadastrarDigital(): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    return this.naoSuportado();
  }

  async cadastrarCartao(): Promise<{ equipamento: string; cartoes: number } & ReplicacaoEquipamentos> {
    return this.naoSuportado();
  }
}

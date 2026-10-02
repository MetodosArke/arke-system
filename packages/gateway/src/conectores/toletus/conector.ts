import type { GatewayService } from "../../core/gatewayService";
import type { GestaoEquipamentos } from "../../equipamentos/controlidGestao";
import { logger } from "../../logger";
import type { Credencial, EquipamentoToletus, Giro, TipoComando } from "../../types";
import { PlacaToletus, type EstadoPlaca, type OpcoesPlaca, type SentidoLiberacao } from "./placa";
import { mensagemDoDisplay, type EventoToletus } from "./protocolo";

/**
 * Liga as placas Toletus à decisão de acesso do Gateway.
 *
 * O caminho é o mesmo das outras marcas, com a mesma regra: a nuvem decide
 * dentro do timeout, o cache decide na queda de internet, e o acesso
 * liberado só vira presença quando a placa conta que a pessoa passou.
 *
 * A Toletus avisa os dois desfechos por conta própria — passagem (0x0304)
 * ou tempo esgotado sem passagem (0x0305) —, como o Monitor da iDBlock e a
 * origem 5/6 da Topdata. Por isso o acesso liberado sempre espera o aviso.
 *
 * **Sem o Gateway, a catraca fica travada.** A placa não guarda lista de
 * alunos: na direção "controlada" ela só libera quando recebe a ordem. É a
 * regra do ARKE (sem confirmar, não libera) sem precisar de configuração
 * nenhuma, ao contrário da Intelbras, que no estado offline libera todo
 * mundo que tem cadastrado.
 */

/** Acesso liberado esperando o aviso de passagem daquela placa. */
type GiroPendente = { logId?: string; localId?: string | null; timer: NodeJS.Timeout };

export interface OpcoesConectorToletus {
  /** Quanto esperar o aviso da placa antes de fechar como "sem confirmação". */
  timeoutGiroMs?: number;
  /** Para os testes encurtarem os tempos da conexão. */
  placa?: Partial<Omit<OpcoesPlaca, "nome" | "ip" | "porta">>;
}

type Decisor = Pick<GatewayService, "validarCredencial" | "registrarAcessoOffline" | "concluirGiro">;

/**
 * Teclado: onze dígitos são CPF, como na Topdata. O resto é identificador
 * do equipamento (número do cartão, matrícula digitada, usuário da
 * biometria), que mora em `alunos.identificador_catraca`.
 */
export function credencialDaLeitura(origem: string, valor: string): Credencial {
  const digitos = valor.replace(/\D/g, "");
  if (origem === "teclado" && digitos.length === 11) return { tipo: "cpf", valor: digitos };
  return { tipo: "identificador_catraca", valor };
}

export class ConectorToletus {
  private readonly placas: PlacaToletus[];
  private readonly sentidos = new Map<string, SentidoLiberacao>();
  private readonly pendentes = new Map<string, GiroPendente>();
  /**
   * Uma decisão por vez em cada placa. Duas leituras seguidas (cartão
   * passado duas vezes) chegam antes de a primeira ser decidida; sem a fila,
   * a segunda poderia liberar antes da primeira e o aviso de passagem
   * fecharia o acesso errado.
   */
  private readonly filas = new Map<string, Promise<void>>();
  private readonly timeoutGiroMs: number;

  constructor(
    private readonly gateway: Decisor,
    equipamentos: EquipamentoToletus[],
    opcoes: OpcoesConectorToletus = {}
  ) {
    this.timeoutGiroMs = opcoes.timeoutGiroMs ?? 30_000;
    this.placas = equipamentos.map((eq) => {
      this.sentidos.set(eq.nome, eq.liberar);
      const placa = new PlacaToletus({ ...opcoes.placa, nome: eq.nome, ip: eq.ip, porta: eq.porta });
      placa.on("evento", (evento: EventoToletus) => this.enfileirar(placa, evento));
      // Placa que caiu com um giro aberto: a pessoa pode ter passado. Fecha
      // como sem confirmação, que conta presença — mesma regra do prazo.
      placa.on("desconectada", () => this.fechar(placa.nome, "sem_confirmacao", "placa desconectada"));
      return placa;
    });
  }

  iniciar(): void {
    for (const p of this.placas) p.iniciar();
  }

  parar(): void {
    for (const p of this.placas) p.parar();
    for (const pendente of this.pendentes.values()) clearTimeout(pendente.timer);
    this.pendentes.clear();
  }

  estados(): EstadoPlaca[] {
    return this.placas.map((p) => p.estado());
  }

  nomes(): string[] {
    return this.placas.map((p) => p.nome);
  }

  /** Liberação remota pela recepção ou pela ArkeFit. Não abre giro pendente: não é acesso de aluno. */
  liberarRemoto(sentido: SentidoLiberacao, equipamento?: string | null): { equipamento: string } {
    const placa = equipamento ? this.placas.find((p) => p.nome === equipamento) : this.placas[0];
    if (!placa) throw new Error(`Equipamento "${equipamento}" não está configurado neste Gateway.`);
    if (!placa.liberar(sentido, "Liberado")) {
      throw new Error(`A catraca "${placa.nome}" não está conectada ao Gateway agora.`);
    }
    logger.info({ equipamento: placa.nome, sentido }, "Catraca Toletus liberada remotamente");
    return { equipamento: placa.nome };
  }

  private enfileirar(placa: PlacaToletus, evento: EventoToletus): void {
    const anterior = this.filas.get(placa.nome) ?? Promise.resolve();
    const proxima = anterior
      .then(() => this.tratar(placa, evento))
      .catch((err) =>
        logger.error({ placa: placa.nome, err: (err as Error).message }, "Falha ao tratar evento da placa Toletus")
      );
    this.filas.set(placa.nome, proxima);
  }

  private fechar(nome: string, giro: Giro, origem: string): void {
    const pendente = this.pendentes.get(nome);
    if (!pendente) return;
    clearTimeout(pendente.timer);
    this.pendentes.delete(nome);
    logger.info({ placa: nome, giro, origem }, "Giro da catraca Toletus registrado");
    void this.gateway.concluirGiro({ logId: pendente.logId, localId: pendente.localId }, giro);
  }

  private async tratar(placa: PlacaToletus, evento: EventoToletus): Promise<void> {
    switch (evento.tipo) {
      case "passagem":
        if (this.pendentes.has(placa.nome)) this.fechar(placa.nome, "confirmado", `passagem de ${evento.direcao}`);
        // Passagem sem liberação nossa: direção livre (a saída costuma ser)
        // ou alguém girou à força. Não é acesso de aluno e não vira presença.
        else logger.debug({ placa: placa.nome, direcao: evento.direcao }, "Passagem sem liberação pendente");
        return;
      case "tempo_esgotado":
        this.fechar(placa.nome, "desistencia", "tempo esgotado sem passagem");
        return;
      case "biometria_nao_cadastrada":
        placa.negar("Nao cadastrado");
        logger.info({ placa: placa.nome }, "Digital não cadastrada no leitor Toletus");
        return;
      case "identificacao":
        await this.decidir(placa, evento.origem, evento.valor);
        return;
      default:
        return;
    }
  }

  private async decidir(placa: PlacaToletus, origem: string, valor: string): Promise<void> {
    if (!valor) {
      placa.negar("Leitura vazia");
      return;
    }
    const credencial = credencialDaLeitura(origem, valor);

    // Leitura nova com giro aberto: o aviso do anterior se perdeu. Fecha como
    // sem confirmação antes de abrir o próximo, senão o aviso do novo fecharia
    // o acesso errado.
    if (this.pendentes.has(placa.nome)) this.fechar(placa.nome, "sem_confirmacao", "nova leitura antes do aviso");

    const resultado = await this.gateway.validarCredencial(credencial, { aguardarGiro: true });
    logger.info(
      { placa: placa.nome, origem, liberado: resultado.liberado, offline: resultado.validadoOffline },
      "Decisão de acesso enviada à placa Toletus"
    );

    // Na contingência ninguém gravou nada ainda: sem isto, o acesso decidido
    // pelo cache numa queda de internet se perderia.
    const localId = await this.gateway.registrarAcessoOffline(
      credencial.tipo === "cpf" ? credencial.valor : `id:${credencial.valor}`,
      resultado,
      resultado.liberado ? "pendente" : undefined
    );

    if (!resultado.liberado) {
      placa.negar(mensagemDoDisplay(false, resultado.mensagem));
      return;
    }

    const sentido = this.sentidos.get(placa.nome) ?? "entrada";
    if (!placa.liberar(sentido, mensagemDoDisplay(true, resultado.mensagem))) {
      // A ordem não chegou à placa: a borboleta não abriu, então ninguém
      // passou. Registrar como presença seria inventar uma entrada.
      logger.warn({ placa: placa.nome }, "Liberação não chegou à placa Toletus — acesso fechado como não girou");
      void this.gateway.concluirGiro({ logId: resultado.logId, localId }, "desistencia");
      return;
    }
    const timer = setTimeout(() => this.fechar(placa.nome, "sem_confirmacao", "prazo esgotado"), this.timeoutGiroMs);
    timer.unref?.();
    this.pendentes.set(placa.nome, { logId: resultado.logId, localId, timer });
  }
}

/**
 * O que a nuvem pode pedir a um Gateway com Toletus. Só liberar a catraca:
 * a placa não guarda usuários, e as digitais ficam no leitor SM25, que tem
 * protocolo próprio — cadastrar e apagar digital pelo ARKE é a etapa
 * seguinte. Até lá a ficha do aluno mostra o campo manual do número, como
 * na Topdata, e a retirada da autorização abre tarefa para a academia
 * apagar a digital no equipamento.
 */
export class GestaoToletus implements GestaoEquipamentos {
  constructor(private readonly conector: ConectorToletus) {}

  nomes(): string[] {
    return this.conector.nomes();
  }

  capacidades(): TipoComando[] {
    return ["liberar_catraca"];
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    return this.conector.estados().map((e) => ({
      equipamento: e.nome,
      ok: e.conectada,
      ...(e.conectada ? {} : { erro: "sem conexão com a placa" }),
    }));
  }

  async liberarCatraca(sentido: SentidoLiberacao, equipamento?: string | null): Promise<{ equipamento: string }> {
    return this.conector.liberarRemoto(sentido, equipamento);
  }

  private naoSuportado(): never {
    throw new Error("A placa Toletus não guarda cadastro de aluno: o número vai na ficha do aluno, no ARKE.");
  }

  async criarUsuario(): Promise<{ equipamentos: string[] }> {
    return this.naoSuportado();
  }

  async apagarUsuario(): Promise<{ equipamentos: string[]; apagados: number }> {
    return this.naoSuportado();
  }

  async cadastrarDigital(): Promise<never> {
    return this.naoSuportado();
  }

  async cadastrarCartao(): Promise<never> {
    return this.naoSuportado();
  }
}

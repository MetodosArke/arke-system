import type { GatewayService } from "../../core/gatewayService";
import type { GestaoEquipamentos, ReplicacaoEquipamentos } from "../../equipamentos/controlidGestao";
import { logger } from "../../logger";
import type { Credencial, EquipamentoToletus, Giro, TipoComando } from "../../types";
import { PlacaToletus, type EstadoPlaca, type OpcoesPlaca, type PlacaConectavel, type SentidoLiberacao } from "./placa";
import { mensagemDoDisplay, type EventoToletus } from "./protocolo";
import { PlacaLiteNet3, type OpcoesPlacaLiteNet3 } from "./litenet3/placa";
import { ServidorLiteNet3 } from "./litenet3/servidor";
import { ErroSM25, SessaoSM25, type OpcoesSessaoSM25, type PassoCadastro } from "./sm25/leitor";
import { ERRO_SM25, MAIOR_NUMERO, PORTA_LEITOR_SM25 } from "./sm25/protocolo";

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

/** O leitor de digital SM25 de uma placa LiteNet2: o mesmo IP da placa, porta 7879. */
export interface LeitorDigitalToletus {
  nome: string;
  ip: string;
  porta: number;
}

/** Acesso liberado esperando o aviso de passagem daquela placa. */
type GiroPendente = { logId?: string; localId?: string | null; timer: NodeJS.Timeout };

export interface OpcoesConectorToletus {
  /** Quanto esperar o aviso da placa antes de fechar como "sem confirmação". */
  timeoutGiroMs?: number;
  /** Para os testes encurtarem os tempos da conexão. */
  placa?: Partial<Omit<OpcoesPlaca, "nome" | "ip" | "porta">>;
  /** Onde as placas LiteNet3 discam (o servidor só sobe se houver LiteNet3 no config). */
  litenet3?: {
    host?: string;
    porta?: number;
    enderecoAnunciado?: string | null;
    /** Para os testes: porta UDP da placa e tempos da conexão. */
    placa?: Partial<Pick<OpcoesPlacaLiteNet3, "portaUdp" | "intervaloAnuncioMs" | "intervaloVidaMs" | "esperaPongMs">>;
  };
}

/** Quanto tempo esperar entre dois avisos de "use o cartão" na LiteNet3. */
const INTERVALO_AVISO_DIGITAL_MS = 5_000;

type Decisor = Pick<GatewayService, "validarCredencial" | "registrarAcessoOffline" | "concluirGiro">;

/**
 * Teclado: só o CPF (onze dígitos), como na Topdata. Os números do
 * equipamento são pequenos e sequenciais (1, 2, 3…), e a catraca não tem
 * senha para conferir: quem digitasse "12" entraria como o aluno 12. Por
 * isso outro número digitado é negado sem ir à nuvem (null). O resto —
 * cartão, código de barras, usuário da biometria — é o identificador do
 * equipamento, que mora em `alunos.identificador_catraca`.
 */
export function credencialDaLeitura(origem: string, valor: string): Credencial | null {
  const digitos = valor.replace(/\D/g, "");
  if (origem === "teclado") return digitos.length === 11 ? { tipo: "cpf", valor: digitos } : null;
  return { tipo: "identificador_catraca", valor };
}

export class ConectorToletus {
  private readonly placas: PlacaConectavel[];
  private readonly servidorLiteNet3: ServidorLiteNet3 | null;
  private readonly avisoDigital = new Map<string, number>();
  private readonly leitores: LeitorDigitalToletus[];
  /** Placas com cadastro de digital em andamento: ver tratar(). */
  private readonly cadastrando = new Set<string>();
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
    this.servidorLiteNet3 = equipamentos.some((eq) => eq.placa === "litenet3")
      ? new ServidorLiteNet3(opcoes.litenet3?.host ?? "0.0.0.0", opcoes.litenet3?.porta ?? 7880)
      : null;
    // O leitor SM25 é da LiteNet2. A LiteNet3 com digital manda a imagem do
    // dedo para o servidor comparar, que é outro leitor e outro caminho.
    this.leitores = equipamentos
      .filter((eq) => eq.leitor_digital && eq.placa !== "litenet3")
      .map((eq) => ({ nome: eq.nome, ip: eq.ip, porta: eq.porta_leitor ?? PORTA_LEITOR_SM25 }));
    this.placas = equipamentos.map((eq) => {
      this.sentidos.set(eq.nome, eq.liberar);
      const placa: PlacaConectavel =
        eq.placa === "litenet3" && this.servidorLiteNet3
          ? new PlacaLiteNet3({
              ...opcoes.litenet3?.placa,
              nome: eq.nome,
              ip: eq.ip,
              serial: eq.serial ?? null,
              servidor: this.servidorLiteNet3,
              enderecoAnunciado: opcoes.litenet3?.enderecoAnunciado ?? null,
            })
          : new PlacaToletus({ ...opcoes.placa, nome: eq.nome, ip: eq.ip, porta: eq.porta });
      placa.on("evento", (evento: EventoToletus) => this.enfileirar(placa, evento));
      // Placa que caiu com um giro aberto: a pessoa pode ter passado. Fecha
      // como sem confirmação, que conta presença — mesma regra do prazo.
      placa.on("desconectada", () => this.fechar(placa.nome, "sem_confirmacao", "placa desconectada"));
      return placa;
    });
  }

  /**
   * O servidor da LiteNet3 sobe antes das placas: elas só discam depois do
   * anúncio. Porta ocupada derruba a inicialização, como a do receptor —
   * subir "quase funcionando" deixaria a catraca sem ninguém para liberar.
   */
  async iniciar(): Promise<void> {
    await this.servidorLiteNet3?.iniciar();
    for (const p of this.placas) p.iniciar();
  }

  /** Porta efetiva do servidor da LiteNet3 (os testes pedem a porta 0). */
  portaLiteNet3(): number | null {
    return this.servidorLiteNet3?.portaEmUso() ?? null;
  }

  parar(): void {
    for (const p of this.placas) p.parar();
    void this.servidorLiteNet3?.parar();
    for (const pendente of this.pendentes.values()) clearTimeout(pendente.timer);
    this.pendentes.clear();
  }

  estados(): EstadoPlaca[] {
    return this.placas.map((p) => p.estado());
  }

  nomes(): string[] {
    return this.placas.map((p) => p.nome);
  }

  leitoresDigitais(): readonly LeitorDigitalToletus[] {
    return this.leitores;
  }

  /** Mensagem no display da catraca, durante o cadastro da digital. Só a LiteNet2 tem leitor SM25. */
  avisar(nome: string, mensagem: string, tom: "passo" | "ok" | "erro"): void {
    const placa = this.placas.find((p) => p.nome === nome);
    if (placa instanceof PlacaToletus) placa.avisar(mensagem, tom);
  }

  marcarCadastro(nome: string, ativo: boolean): void {
    if (ativo) this.cadastrando.add(nome);
    else this.cadastrando.delete(nome);
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

  private enfileirar(placa: PlacaConectavel, evento: EventoToletus): void {
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

  private async tratar(placa: PlacaConectavel, evento: EventoToletus): Promise<void> {
    // Com a digital sendo cadastrada, o dedo no leitor é do aluno que está
    // cadastrando. Se a placa reconhecer esse dedo (digital antiga ainda no
    // leitor) e o ARKE liberar, a catraca abriria no meio do cadastro e
    // contaria uma presença que ninguém fez. Cartão e teclado seguem valendo.
    if (
      this.cadastrando.has(placa.nome) &&
      (evento.tipo === "biometria_nao_cadastrada" || (evento.tipo === "identificacao" && evento.origem === "biometria"))
    ) {
      logger.info({ placa: placa.nome }, "Leitura de digital durante o cadastro: ignorada");
      return;
    }
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
      case "biometria_imagem": {
        // A imagem do dedo chega em vários pedaços; um aviso basta. O
        // conteúdo nunca é guardado: a placa só repassa que ele chegou.
        const ultimo = this.avisoDigital.get(placa.nome) ?? 0;
        if (Date.now() - ultimo < INTERVALO_AVISO_DIGITAL_MS) return;
        this.avisoDigital.set(placa.nome, Date.now());
        placa.negar("Use o cartao");
        logger.warn(
          { placa: placa.nome },
          "A LiteNet3 mandou a imagem de uma digital para comparar no servidor — o ARKE não compara digital fora do equipamento; use cartão, código ou teclado"
        );
        return;
      }
      case "identificacao":
        await this.decidir(placa, evento.origem, evento.valor);
        return;
      default:
        return;
    }
  }

  private async decidir(placa: PlacaConectavel, origem: string, valor: string): Promise<void> {
    if (!valor) {
      placa.negar("Leitura vazia");
      return;
    }
    const credencial = credencialDaLeitura(origem, valor);
    if (!credencial) {
      // Não abre acesso nem fecha o giro de quem está passando: é só um
      // número digitado que não é CPF.
      placa.negar("Digite o CPF");
      logger.info({ placa: placa.nome }, "Teclado sem CPF: negado sem consultar a nuvem");
      return;
    }

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

/** Tempo máximo do cadastro: o aluno põe o dedo três vezes, como na Control iD. */
const PRAZO_CADASTRO_MS = 90_000;
/**
 * O tempo de espera do dedo que a própria Toletus grava no leitor ao achar
 * a placa (LiteNet2Board.CreateFingerprintReader). O padrão de fábrica, 5 s,
 * não dá tempo de a recepção explicar ao aluno o que fazer.
 */
const TEMPO_DO_DEDO_S = 60;

export interface OpcoesGestaoToletus {
  prazoCadastroMs?: number;
  sessao?: Omit<OpcoesSessaoSM25, "ip" | "porta">;
}

const TEXTO_DO_PASSO: Record<string, string> = {
  "toque:1": "Ponha o dedo 1/3",
  "toque:2": "Ponha o dedo 2/3",
  "toque:3": "Ponha o dedo 3/3",
  tirar_o_dedo: "Tire o dedo",
  qualidade_ruim: "Leitura ruim",
};

function textoDoPasso(p: PassoCadastro): string {
  return TEXTO_DO_PASSO[p.tipo === "toque" ? `toque:${p.vez}` : p.tipo];
}

function mensagem(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * O que a nuvem pode pedir a um Gateway com Toletus.
 *
 * A placa não guarda cadastro de aluno: decide quem passa perguntando ao
 * Gateway. O que fica no equipamento é a digital, no leitor SM25 da placa
 * LiteNet2, guardada sob um número — o número que a placa manda quando
 * reconhece o dedo, e que é o `identificador_catraca` do aluno no ARKE.
 * Com `leitor_digital` no config, a ficha do aluno cadastra a digital com o
 * aluno na frente do leitor, copia para os leitores das outras catracas, e
 * a saída do aluno apaga a digital de todos eles.
 *
 * Cartão não se cadastra daqui: o número vem do próprio cartão, e a ficha o
 * vincula à mão. Cada aluno tem um número só — o do cartão ou o da digital.
 */
export class GestaoToletus implements GestaoEquipamentos {
  private readonly prazoCadastroMs: number;
  private readonly sessao: Omit<OpcoesSessaoSM25, "ip" | "porta">;

  constructor(
    private readonly conector: ConectorToletus,
    opcoes: OpcoesGestaoToletus = {}
  ) {
    this.prazoCadastroMs = opcoes.prazoCadastroMs ?? PRAZO_CADASTRO_MS;
    this.sessao = opcoes.sessao ?? {};
  }

  nomes(): string[] {
    return this.conector.nomes();
  }

  /** Só as catracas com leitor de digital aparecem na ficha para o cadastro. */
  nomesDeCadastro(): string[] {
    return this.conector.leitoresDigitais().map((l) => l.nome);
  }

  capacidades(): TipoComando[] {
    return this.conector.leitoresDigitais().length
      ? ["liberar_catraca", "cadastrar_usuario", "cadastrar_digital", "apagar_usuario"]
      : ["liberar_catraca"];
  }

  async testar(): Promise<{ equipamento: string; ok: boolean; erro?: string }[]> {
    const placas = this.conector.estados().map((e) => ({
      equipamento: e.nome,
      ok: e.conectada,
      ...(e.conectada ? {} : { erro: "sem conexão com a placa" }),
    }));
    const leitores = await Promise.all(
      this.conector.leitoresDigitais().map(async (l) => {
        try {
          await this.comLeitor(l, (s) => s.testar());
          return { equipamento: `${l.nome} (leitor de digital)`, ok: true };
        } catch (err) {
          return { equipamento: `${l.nome} (leitor de digital)`, ok: false, erro: mensagem(err) };
        }
      })
    );
    return [...placas, ...leitores];
  }

  async liberarCatraca(sentido: SentidoLiberacao, equipamento?: string | null): Promise<{ equipamento: string }> {
    return this.conector.liberarRemoto(sentido, equipamento);
  }

  /**
   * Na Toletus, "cadastrar o aluno" é só aceitar o número que a nuvem deu:
   * a placa não guarda usuário. Confere que o número cabe no leitor antes
   * de a nuvem gravá-lo, para a digital não falhar depois por isso.
   */
  async criarUsuario(userId: number): Promise<{ equipamentos: string[]; mensagem: string }> {
    this.exigirLeitores();
    const numero = this.numeroDoLeitor(userId);
    return {
      equipamentos: [],
      mensagem: `Número ${numero} reservado ao aluno. A catraca Toletus não guarda cadastro: a digital entra pelo botão "Cadastrar digital".`,
    };
  }

  /**
   * A digital com o aluno na frente do leitor escolhido, copiada depois para
   * os leitores das outras catracas.
   *
   * Recadastrar troca a digital, e o leitor só cadastra em número vazio.
   * Apagar antes e falhar depois deixaria o aluno sem entrar — então a
   * digital anterior é lida antes, e volta para o leitor se o cadastro novo
   * não sair. O registro atravessa só a memória do Gateway e é zerado.
   */
  async cadastrarDigital(
    userId: number,
    equipamento?: string | null
  ): Promise<{ equipamento: string } & ReplicacaoEquipamentos> {
    const numero = this.numeroDoLeitor(userId);
    const leitor = this.escolher(equipamento);
    const outros = this.conector.leitoresDigitais().filter((l) => l.nome !== leitor.nome);
    // A digital lida para a cópia: fora do try, para ser zerada no fim em qualquer caminho.
    const copia: { registro: Buffer | null; erro: string | null } = { registro: null, erro: null };

    this.conector.marcarCadastro(leitor.nome, true);
    try {
      await this.comLeitor(leitor, async (s) => {
        await this.garantirTempoDoDedo(s, leitor.nome);
        const anterior = (await s.ocupado(numero)) ? await s.lerRegistro(numero) : null;
        try {
          if (anterior) await s.apagar(numero);
          this.conector.avisar(leitor.nome, "Cadastro digital", "passo");
          await s.cadastrar(numero, {
            prazoMs: this.prazoCadastroMs,
            aoPasso: (p) => this.conector.avisar(leitor.nome, textoDoPasso(p), "passo"),
          });
          this.conector.avisar(leitor.nome, "Digital salva", "ok");
        } catch (err) {
          this.conector.avisar(leitor.nome, "Cadastro falhou", "erro");
          const restaurada = anterior ? await this.restaurar(s, numero, anterior, leitor.nome) : null;
          throw new Error(this.traduzir(err, numero, leitor.nome, restaurada));
        } finally {
          anterior?.fill(0);
        }
        if (outros.length) {
          try {
            copia.registro = await s.lerRegistro(numero);
          } catch (err) {
            copia.erro = `não foi possível ler a digital para copiar (${mensagem(err)})`;
          }
        }
      });
    } finally {
      this.conector.marcarCadastro(leitor.nome, false);
    }

    const replicado_em: string[] = [];
    const falhou_em: { equipamento: string; erro: string }[] = [];
    try {
      for (const outro of outros) {
        const r = copia.registro;
        if (!r) {
          falhou_em.push({ equipamento: outro.nome, erro: copia.erro ?? "sem a digital para copiar" });
          continue;
        }
        try {
          await this.comLeitor(outro, async (s) => {
            await s.apagar(numero);
            await s.gravarRegistro(numero, r);
          });
          replicado_em.push(outro.nome);
        } catch (err) {
          falhou_em.push({ equipamento: outro.nome, erro: mensagem(err) });
        }
      }
    } finally {
      copia.registro?.fill(0);
    }
    logger.info({ equipamento: leitor.nome, replicado_em, falhas: falhou_em.length }, "Digital cadastrada no leitor Toletus");
    return { equipamento: leitor.nome, replicado_em, falhou_em };
  }

  /**
   * Apaga a digital do número em todos os leitores. Número que não cabe no
   * leitor nunca esteve nele (é o de um cartão). Falha em um leitor falha a
   * ordem inteira: ela continua pendente e a nuvem tenta de novo, e apagar
   * de novo onde já saiu não faz mal.
   */
  async apagarUsuario(userId: number): Promise<{ equipamentos: string[]; apagados: number }> {
    const leitores = this.conector.leitoresDigitais();
    if (!Number.isInteger(userId) || userId < 1 || userId > MAIOR_NUMERO) {
      return { equipamentos: leitores.map((l) => l.nome), apagados: 0 };
    }
    const equipamentos: string[] = [];
    const falhas: string[] = [];
    let apagados = 0;
    for (const leitor of leitores) {
      try {
        if (await this.comLeitor(leitor, (s) => s.apagar(userId))) apagados++;
        equipamentos.push(leitor.nome);
      } catch (err) {
        falhas.push(`${leitor.nome} (${mensagem(err)})`);
      }
    }
    if (falhas.length) {
      throw new Error(`Não foi possível apagar a digital do número ${userId} em: ${falhas.join("; ")}.`);
    }
    return { equipamentos, apagados };
  }

  async cadastrarCartao(): Promise<never> {
    throw new Error(
      'Na Toletus o número vem do próprio cartão: passe o cartão na catraca, veja o número em Catracas → Últimos acessos e vincule na ficha do aluno.'
    );
  }

  private exigirLeitores(): void {
    if (!this.conector.leitoresDigitais().length) {
      throw new Error('Nenhuma catraca Toletus tem "leitor_digital" no config do Gateway: a digital é cadastrada no equipamento.');
    }
  }

  private numeroDoLeitor(userId: number): number {
    if (Number.isInteger(userId) && userId >= 1 && userId <= MAIOR_NUMERO) return userId;
    throw new Error(
      `O aluno está com o número ${userId}, que não cabe no leitor de digital da Toletus (vai até ${MAIOR_NUMERO}). ` +
        `Se ${userId} é o número do cartão, o aluno segue entrando com o cartão: na Toletus cada aluno tem um número só, o do cartão ou o da digital.`
    );
  }

  private escolher(equipamento?: string | null): LeitorDigitalToletus {
    this.exigirLeitores();
    const leitores = this.conector.leitoresDigitais();
    if (!equipamento) return leitores[0];
    const leitor = leitores.find((l) => l.nome === equipamento);
    if (!leitor) throw new Error(`A catraca "${equipamento}" não tem leitor de digital configurado neste Gateway.`);
    return leitor;
  }

  private async comLeitor<T>(leitor: LeitorDigitalToletus, operacao: (s: SessaoSM25) => Promise<T>): Promise<T> {
    let s: SessaoSM25;
    try {
      s = await SessaoSM25.abrir({ ...this.sessao, ip: leitor.ip, porta: leitor.porta });
    } catch (err) {
      throw new Error(`O leitor de digital da catraca "${leitor.nome}" não atendeu (${mensagem(err)}).`);
    }
    try {
      return await operacao(s);
    } finally {
      s.fechar();
    }
  }

  private async garantirTempoDoDedo(s: SessaoSM25, nome: string): Promise<void> {
    try {
      if ((await s.tempoDoDedo()) < 30) await s.definirTempoDoDedo(TEMPO_DO_DEDO_S);
    } catch (err) {
      // O cadastro ainda funciona com o tempo de fábrica; só fica apertado.
      logger.warn({ equipamento: nome, err: mensagem(err) }, "Não foi possível ajustar o tempo do dedo no leitor Toletus");
    }
  }

  /** Devolve a digital anterior ao leitor. Responde se conseguiu. */
  private async restaurar(s: SessaoSM25, numero: number, anterior: Buffer, nome: string): Promise<boolean> {
    try {
      await s.cancelar();
      await s.apagar(numero);
      await s.gravarRegistro(numero, anterior);
      return true;
    } catch (err) {
      logger.error({ equipamento: nome, numero, err: mensagem(err) }, "A digital anterior não voltou ao leitor Toletus");
      return false;
    }
  }

  private traduzir(err: unknown, numero: number, nome: string, restaurada: boolean | null): string {
    const anterior =
      restaurada === true
        ? " A digital anterior continua valendo."
        : restaurada === false
          ? " A digital anterior não pôde ser recolocada: o aluno fica sem digital até o novo cadastro sair."
          : "";
    if (!(err instanceof ErroSM25)) return `Leitor de digital da catraca "${nome}": ${mensagem(err)}.${anterior}`;
    switch (err.codigo) {
      case ERRO_SM25.DIGITAL_REPETIDA:
        return (
          `Esta digital já está no leitor da catraca "${nome}"${err.repetidaEm ? ` com o número ${err.repetidaEm}` : ""}. ` +
          `O mesmo dedo não vale para dois números: use outro dedo.${anterior}`
        );
      case ERRO_SM25.TEMPO_ESGOTADO:
        return `O aluno não pôs o dedo a tempo no leitor da catraca "${nome}". Repita com ele na frente do leitor.${anterior}`;
      case ERRO_SM25.FALHA_AO_UNIR:
        return `As três leituras não bateram. Repita usando o mesmo dedo nas três vezes.${anterior}`;
      case ERRO_SM25.NUMERO_INVALIDO:
        return `O leitor da catraca "${nome}" não guarda o número ${numero}: ele passa da capacidade do leitor (3.000 digitais).${anterior}`;
      default:
        return `Leitor de digital da catraca "${nome}": ${err.message}.${anterior}`;
    }
  }
}

import { EventEmitter } from "node:events";
import type { ICloudClient, OpcoesValidacao } from "../cloud/client";
import type { AlunosCache } from "../offline/alunosCache";
import type { LogsQueue } from "../offline/logsQueue";
import type { CatracaDriver } from "../drivers/CatracaDriver";
import type {
  Credencial,
  GatewayConfig,
  Giro,
  LeituraCredencial,
  ResultadoLog,
  ResultadoValidacao,
  StatusGateway,
} from "../types";
import { logger } from "../logger";
import { RegistroEquipamentos } from "../equipamentos/registro";
import { mensagemDoDisplay } from "./display";

const INTERVALO_FLUSH_LOGS_MS = 30_000;
/** A retenção dos acessos já entregues roda ao subir e a cada 6 horas. */
const INTERVALO_RETENCAO_MS = 6 * 3600_000;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Orquestra o fluxo completo: lê credencial da catraca → valida na nuvem
 * (com timeout estrito) → cai para o cache local se a nuvem falhar/
 * demorar → comanda o driver a liberar/negar → registra o acesso (a
 * própria Edge Function já grava quando a validação foi online; quando é
 * offline, fica na fila local até sincronizar).
 */
export class GatewayService extends EventEmitter {
  private status: StatusGateway = "offline";
  private timerSincronizacao: NodeJS.Timeout | null = null;
  private ultimaSincronizacao: string | undefined;
  private sincronizando = false;
  private timerFlushLogs: NodeJS.Timeout | null = null;
  private timerRetencao: NodeJS.Timeout | null = null;
  private ultimaSincronizacaoOk: string | null = null;
  /** Quem quer saber que o cache mudou (o espelho da situação nos terminais Intelbras). */
  private readonly aposSincronizar: (() => void)[] = [];
  private ultimoErro: { mensagem: string; em: string } | null = null;

  /** Quem deu sinal desde que o Gateway subiu — alimentado pelos receptores. */
  readonly equipamentos = new RegistroEquipamentos();

  constructor(
    private readonly config: GatewayConfig,
    private readonly driver: CatracaDriver,
    private readonly cloud: ICloudClient,
    private readonly alunosCache: AlunosCache,
    private readonly logsQueue: LogsQueue
  ) {
    super();
  }

  getStatus(): StatusGateway {
    return this.status;
  }

  /** O estado que a telemetria leva à nuvem e o /status mostra ao técnico. */
  async estado(): Promise<{
    status: StatusGateway;
    filaOffline: number;
    cacheAlunos: number;
    ultimaSincronizacao: string | null;
    ultimoErro: { mensagem: string; em: string } | null;
  }> {
    const [filaOffline, cacheAlunos] = await Promise.all([
      this.logsQueue.contarPendentes().catch(() => 0),
      this.alunosCache.contar().catch(() => 0),
    ]);
    return {
      status: this.status,
      filaOffline,
      cacheAlunos,
      ultimaSincronizacao: this.ultimaSincronizacaoOk,
      ultimoErro: this.ultimoErro,
    };
  }

  /**
   * Guarda o último erro para a telemetria. Só a mensagem, curta: o que
   * chega aqui são falhas de rede e de nuvem, nunca dado de aluno — quem
   * chama não passa CPF nem nome.
   */
  private registrarErro(contexto: string, err: unknown): void {
    const mensagem = `${contexto}: ${(err as Error)?.message ?? String(err)}`.slice(0, 300);
    this.ultimoErro = { mensagem, em: new Date().toISOString() };
  }

  async iniciar(): Promise<void> {
    await this.driver.conectar();
    this.driver.aoLerCredencial((leitura) => {
      this.processarLeitura(leitura).catch((err) =>
        logger.error({ err: (err as Error).message }, "Falha inesperada ao processar leitura da catraca")
      );
    });

    await this.sincronizarAlunosComTratamento();
    this.timerSincronizacao = setInterval(
      () => void this.sincronizarAlunosComTratamento(),
      this.config.sincronizar_alunos_intervalo_ms
    );
    this.timerFlushLogs = setInterval(() => void this.flushLogsPendentes(), INTERVALO_FLUSH_LOGS_MS);
    void this.aplicarRetencao();
    this.timerRetencao = setInterval(() => void this.aplicarRetencao(), INTERVALO_RETENCAO_MS);
    this.timerRetencao.unref?.();
  }

  async parar(): Promise<void> {
    if (this.timerSincronizacao) clearInterval(this.timerSincronizacao);
    if (this.timerFlushLogs) clearInterval(this.timerFlushLogs);
    if (this.timerRetencao) clearInterval(this.timerRetencao);
    await this.driver.desconectar();
  }

  /**
   * Apaga do computador da recepção os acessos que já subiram há mais de 30
   * dias (CPF consultado, aluno e horário). Falha aqui não para nada: tenta
   * de novo na próxima rodada.
   */
  async aplicarRetencao(agora: Date = new Date()): Promise<number> {
    try {
      const n = await this.logsQueue.limparAntigos(undefined, agora);
      if (n > 0) logger.info({ apagados: n }, "Acessos antigos já entregues à nuvem apagados deste computador");
      return n;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Falha ao apagar acessos antigos — tentando de novo mais tarde");
      return 0;
    }
  }

  private setStatus(novo: StatusGateway): void {
    if (novo !== this.status) {
      this.status = novo;
      this.emit("status", novo);
      logger.info({ status: novo }, "Status do gateway mudou");
    }
  }

  async processarLeitura(leitura: LeituraCredencial): Promise<void> {
    if (leitura.tipo !== "cpf") {
      // A Edge Function catraca-validar-acesso hoje só valida por CPF —
      // outros tipos de credencial são capturados pelo driver mas ainda
      // não têm um mapeamento para CPF no backend. Registrado como aviso
      // em vez de fingir que funciona.
      logger.warn({ tipo: leitura.tipo }, "Tipo de credencial ainda não suportado pela validação na nuvem");
      await this.driver.negarAcesso("Tipo de credencial não suportado");
      return;
    }

    const cpf = leitura.valor.replace(/\D/g, "");
    const resultado = await this.validarAcesso(cpf);

    // O display é público: a frase de todas as marcas, nunca o nome.
    if (resultado.liberado) {
      await this.driver.liberarAcesso(mensagemDoDisplay(true, resultado.mensagem));
    } else {
      await this.driver.negarAcesso(mensagemDoDisplay(false, resultado.mensagem));
    }

    await this.registrarLogSeNecessario(cpf, resultado);
  }

  /** Exposto para os testes e para o servidor local de diagnóstico. */
  async validarAcesso(cpf: string): Promise<ResultadoValidacao> {
    return this.validarCredencial({ tipo: "cpf", valor: cpf });
  }

  /**
   * Caminho único de decisão, seja CPF digitado ou usuário identificado
   * por biometria no equipamento. Tenta a nuvem dentro do timeout e cai
   * para o cache local se ela falhar ou demorar.
   */
  async validarCredencial(credencial: Credencial, opcoes: OpcoesValidacao = {}): Promise<ResultadoValidacao> {
    try {
      const resposta = this.cloud.validarCredencial
        ? await this.cloud.validarCredencial(credencial, opcoes)
        : await this.cloud.validarAcesso(credencial.valor);
      if (resposta.error) throw new Error(resposta.error);
      this.setStatus("online");
      // `aluno_nome` (nuvem anterior a 06/10/2026) fica de fora de propósito.
      return {
        liberado: !!resposta.liberado,
        mensagem: resposta.motivo ?? "",
        validadoOffline: false,
        logId: resposta.log_id,
      };
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, credencial: credencial.tipo },
        "Falha ou timeout ao validar na nuvem — acionando contingência offline"
      );
      this.registrarErro("validação na nuvem", err);
      return this.validarOffline(credencial);
    }
  }

  private async validarOffline(credencial: Credencial): Promise<ResultadoValidacao> {
    const total = await this.alunosCache.contar();
    if (total === 0) {
      this.setStatus("offline");
      return {
        liberado: false,
        mensagem: "Sem conexão com a nuvem e cache local ainda vazio.",
        validadoOffline: true,
        resultadoLog: "negado_catraca_inativa",
      };
    }

    this.setStatus("contingencia");
    const aluno =
      credencial.tipo === "cpf"
        ? await this.alunosCache.buscarPorCpf(credencial.valor)
        : await this.alunosCache.buscarPorIdentificador(credencial.valor);
    if (!aluno) {
      return {
        liberado: false,
        mensagem: "Aluno não encontrado no cache local.",
        validadoOffline: true,
        resultadoLog: "negado_nao_encontrado",
      };
    }
    if (aluno.inadimplente) {
      // O cache não separa pausado de inadimplente (o contrato é "não
      // entra"). O texto não fala de dinheiro: até a 1.8 dizia "Assinatura
      // em atraso", e a ponte Topdata o escrevia no display.
      return {
        liberado: false,
        mensagem: "Procure a recepção (validado pelo cache local).",
        alunoId: aluno.aluno_id,
        validadoOffline: true,
        resultadoLog: "negado_inadimplente",
      };
    }
    return {
      liberado: true,
      mensagem: "Acesso liberado (contingência offline).",
      alunoId: aluno.aluno_id,
      validadoOffline: true,
      resultadoLog: "liberado",
    };
  }

  private async registrarLogSeNecessario(cpf: string, resultado: ResultadoValidacao): Promise<void> {
    await this.registrarAcessoOffline(cpf, resultado);
  }

  /**
   * Enfileira um acesso decidido na contingência, e devolve o id local para
   * o giro ser fechado depois. Validações online já são gravadas pela
   * própria catraca-validar-acesso; aqui só entra o que foi decidido pelo
   * cache. Público porque os receptores de fabricante decidem por conta
   * própria e também precisam registrar — antes o da Control iD não
   * registrava, e o acesso pela catraca na queda de internet se perdia.
   */
  async registrarAcessoOffline(
    credencialLog: string,
    resultado: ResultadoValidacao,
    giro?: Giro | "pendente"
  ): Promise<string | null> {
    if (!resultado.validadoOffline) return null;
    return this.logsQueue.adicionar({
      aluno_id: resultado.alunoId ?? null,
      cpf_consultado: credencialLog,
      resultado: this.classificarResultadoLog(resultado),
      ocorrido_em: new Date().toISOString(),
      sincronizado: false,
      ...(giro ? { giro } : {}),
    });
  }

  /**
   * Fecha o giro de um acesso liberado. Melhor esforço: se a nuvem não
   * responder, o registro fica pendente e fechar_giros_pendentes() o fecha
   * como sem confirmação — que conta presença. Um aviso perdido pode, no
   * pior caso, contar uma desistência; nunca apagar a presença de quem
   * entrou.
   */
  /**
   * Passagem que o próprio equipamento registrou (bilhete Topdata),
   * coletada pela ponte quando o equipamento volta a falar com ela.
   *
   * Com a configuração da ponte a catraca sozinha não libera ninguém, então
   * bilhete não deveria existir; quando existe, é passagem que aconteceu
   * (cartão mestre, liberação manual no equipamento) e vai para a nuvem
   * como acesso com giro confirmado — é isso que o bilhete atesta. O aluno
   * sai do cache pelo identificador; sem ele o registro sobe mesmo assim,
   * para auditoria, só não vira presença de ninguém.
   */
  async registrarBilheteEquipamento(identificador: string, ocorridoEm: string): Promise<string> {
    const aluno = identificador ? await this.alunosCache.buscarPorIdentificador(identificador) : null;
    const id = await this.logsQueue.adicionar({
      aluno_id: aluno?.aluno_id ?? null,
      cpf_consultado: `id:${identificador}`,
      resultado: "liberado",
      ocorrido_em: ocorridoEm,
      sincronizado: false,
      giro: "confirmado",
    });
    void this.flushLogsPendentes();
    return id;
  }

  async concluirGiro(alvo: { logId?: string; localId?: string | null }, giro: Giro): Promise<void> {
    try {
      if (alvo.logId && this.cloud.confirmarGiro) {
        await this.cloud.confirmarGiro(alvo.logId, giro);
      } else if (alvo.localId) {
        await this.logsQueue.fecharGiro(alvo.localId, giro);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, giro }, "Não foi possível registrar o giro — a nuvem fecha como sem confirmação");
    }
  }

  private classificarResultadoLog(resultado: ResultadoValidacao): ResultadoLog {
    if (resultado.resultadoLog) return resultado.resultadoLog;
    if (resultado.liberado) return "liberado";
    const mensagem = resultado.mensagem.toLowerCase();
    if (mensagem.includes("pausad")) return "negado_pausado";
    if (mensagem.includes("atraso")) return "negado_inadimplente";
    if (mensagem.includes("não encontrado")) return "negado_nao_encontrado";
    return "negado_catraca_inativa";
  }

  /** Chamado depois de cada sincronização que deu certo. Não espera ninguém: quem ouve cuida dos próprios erros. */
  aoSincronizar(fn: () => void): void {
    this.aposSincronizar.push(fn);
  }

  /** Os alunos com número no equipamento e se estão barrados, do cache local. */
  async alunosNoEquipamento(): Promise<{ identificador: string; barrado: boolean }[]> {
    return this.alunosCache.comIdentificador();
  }

  /**
   * Mantém o cache offline igual à nuvem. Desde 23/09/2026 pede só a
   * diferença desde a última sincronização — a lista inteira a cada 5
   * minutos era quase todo o tráfego da plataforma — e confere o resultado
   * pelo hash dos ids. Se não bater, pede a lista inteira na mesma rodada:
   * exclusão de aluno não deixa linha para aparecer na diferença, e o hash
   * é o que pega isso e qualquer divergência que ninguém previu.
   *
   * `ultimaSincronizacao` fica só em memória de propósito: gateway que
   * reinicia começa com a lista inteira, que é o estado seguro.
   */
  async sincronizarAlunosComTratamento(): Promise<void> {
    // O timer não espera a rodada anterior terminar; duas ao mesmo tempo
    // poderiam aplicar diferenças fora de ordem.
    if (this.sincronizando) return;
    this.sincronizando = true;
    try {
      await this.sincronizarAlunos(false);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Falha ao sincronizar a lista de alunos com a nuvem");
      this.registrarErro("sincronização de alunos", err);
    } finally {
      this.sincronizando = false;
    }
  }

  /**
   * Ordem da nuvem ("sincronizar agora", pela Visão Master ou pela academia):
   * a lista inteira, sem esperar o próximo ciclo. Espera a rodada em curso
   * terminar em vez de pular, porque quem pediu está esperando a resposta —
   * e, ao contrário do timer, devolve o erro em vez de engolir.
   */
  async forcarSincronizacaoCompleta(): Promise<{ total: number }> {
    const limite = Date.now() + 30_000;
    while (this.sincronizando) {
      if (Date.now() > limite) throw new Error("Outra sincronização não terminou em 30 s.");
      await dormir(100);
    }
    this.sincronizando = true;
    try {
      await this.sincronizarAlunos(true);
      return { total: await this.alunosCache.contar() };
    } catch (err) {
      this.registrarErro("sincronização de alunos", err);
      throw err;
    } finally {
      this.sincronizando = false;
    }
  }

  private async sincronizarAlunos(completo: boolean): Promise<void> {
    let resposta = await this.cloud.sincronizarAlunos(
      completo ? { completo: true } : this.ultimaSincronizacao ? { desde: this.ultimaSincronizacao } : {}
    );
    if (resposta.error) throw new Error(resposta.error);

    // Nuvem antiga não manda `completo`: é lista inteira, como antes.
    if (resposta.completo === false) {
      await this.alunosCache.aplicarDiferenca(resposta.alunos ?? [], resposta.remover ?? []);
      if (resposta.ids_hash && (await this.alunosCache.hashIds()) !== resposta.ids_hash) {
        logger.warn("Cache local divergiu da nuvem depois da diferença — pedindo a lista inteira");
        resposta = await this.cloud.sincronizarAlunos({ completo: true });
        if (resposta.error) throw new Error(resposta.error);
        await this.alunosCache.substituirTodos(resposta.alunos ?? []);
      } else {
        logger.info(
          { alterados: resposta.alunos?.length ?? 0, removidos: resposta.remover?.length ?? 0 },
          "Cache local de alunos atualizado pela diferença"
        );
      }
    } else {
      await this.alunosCache.substituirTodos(resposta.alunos ?? []);
      logger.info({ total: resposta.alunos?.length ?? 0 }, "Cache local de alunos sincronizado com a nuvem");
    }
    // Só avança o marco depois de aplicar: se a gravação local falhar, a
    // próxima rodada pede de novo a partir do marco anterior.
    this.ultimaSincronizacao = resposta.sincronizado_em;
    this.ultimaSincronizacaoOk = new Date().toISOString();
    this.setStatus("online");
    for (const fn of this.aposSincronizar) fn();
    await this.flushLogsPendentes();
  }

  async flushLogsPendentes(): Promise<void> {
    try {
      await this.enviarLogsPendentes();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Falha ao sincronizar logs offline — tentando de novo mais tarde");
      this.registrarErro("envio de acessos offline", err);
    }
  }

  /**
   * Mesmo envio, devolvendo o erro — é o que a ordem "enviar logs" da nuvem
   * usa. Devolve quantos a nuvem aceitou.
   *
   * Cada registro vai com o id local, e a nuvem diz o que fez com cada um
   * (desde 06/10/2026): aceito, ou recusado de vez (aluno que não é da
   * academia, data fora da janela, dado torto). Os dois saem da fila. Antes
   * a nuvem gravava o lote numa instrução só: um registro com problema (o
   * aluno excluído durante a queda, por exemplo) derrubava o lote, e o
   * Gateway reenviava os mesmos 500 para sempre — a fila daquela catraca
   * parava. O que a nuvem não citar fica para a próxima tentativa.
   *
   * Nuvem antiga, sem a lista: o 200 vale como aceite de todos, como antes.
   */
  async enviarLogsPendentes(): Promise<number> {
    const pendentes = await this.logsQueue.listarPendentes();
    if (pendentes.length === 0) return 0;

    const resposta = await this.cloud.sincronizarLogsOffline(
      pendentes.map((p) => ({
        id_local: p._id,
        aluno_id: p.aluno_id,
        cpf_consultado: p.cpf_consultado,
        resultado: p.resultado,
        ocorrido_em: p.ocorrido_em,
        ...(p.giro ? { giro: p.giro } : {}),
      }))
    );

    if (!Array.isArray(resposta.aceitos)) {
      await this.logsQueue.marcarSincronizados(pendentes.map((p) => p._id));
      logger.info({ total: pendentes.length }, "Logs offline sincronizados com a nuvem");
      return pendentes.length;
    }

    const enviados = new Set(pendentes.map((p) => p._id));
    const aceitos = resposta.aceitos.filter((id) => enviados.has(id));
    const descartados = (resposta.descartados ?? [])
      .filter((d) => d && typeof d.id_local === "string" && enviados.has(d.id_local))
      .map((d) => ({ id: d.id_local as string, motivo: String(d.motivo ?? "recusado pela nuvem") }));
    await this.logsQueue.marcarSincronizados(aceitos);
    await this.logsQueue.marcarDescartados(descartados);

    const ficaram = pendentes.length - aceitos.length - descartados.length;
    if (descartados.length > 0) {
      // Sem CPF nem aluno no log: só quantos e por quê.
      const motivos = [...new Set(descartados.map((d) => d.motivo))];
      logger.warn({ descartados: descartados.length, motivos }, "A nuvem recusou acessos offline de vez — saíram da fila");
    }
    logger.info({ aceitos: aceitos.length, descartados: descartados.length, ficaram }, "Logs offline sincronizados com a nuvem");
    return aceitos.length;
  }
}

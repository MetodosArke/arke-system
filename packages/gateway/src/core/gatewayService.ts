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

const INTERVALO_FLUSH_LOGS_MS = 30_000;

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
  private timerFlushLogs: NodeJS.Timeout | null = null;

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
  }

  async parar(): Promise<void> {
    if (this.timerSincronizacao) clearInterval(this.timerSincronizacao);
    if (this.timerFlushLogs) clearInterval(this.timerFlushLogs);
    await this.driver.desconectar();
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

    if (resultado.liberado) {
      await this.driver.liberarAcesso(resultado.nomeAluno ?? "Aluno");
    } else {
      await this.driver.negarAcesso(resultado.mensagem);
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
      return {
        liberado: !!resposta.liberado,
        mensagem: resposta.motivo ?? "",
        nomeAluno: resposta.aluno_nome,
        validadoOffline: false,
        logId: resposta.log_id,
      };
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, credencial: credencial.tipo },
        "Falha ou timeout ao validar na nuvem — acionando contingência offline"
      );
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
      };
    }

    this.setStatus("contingencia");
    const aluno =
      credencial.tipo === "cpf"
        ? await this.alunosCache.buscarPorCpf(credencial.valor)
        : await this.alunosCache.buscarPorIdentificador(credencial.valor);
    if (!aluno) {
      return { liberado: false, mensagem: "Aluno não encontrado no cache local.", validadoOffline: true };
    }
    if (aluno.inadimplente) {
      return {
        liberado: false,
        mensagem: "Assinatura em atraso (validado pelo cache local).",
        nomeAluno: aluno.nome,
        alunoId: aluno.aluno_id,
        validadoOffline: true,
      };
    }
    return {
      liberado: true,
      mensagem: "Acesso liberado (contingência offline).",
      nomeAluno: aluno.nome,
      alunoId: aluno.aluno_id,
      validadoOffline: true,
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
    if (resultado.liberado) return "liberado";
    const mensagem = resultado.mensagem.toLowerCase();
    if (mensagem.includes("pausad")) return "negado_pausado";
    if (mensagem.includes("atraso")) return "negado_inadimplente";
    if (mensagem.includes("não encontrado")) return "negado_nao_encontrado";
    return "negado_catraca_inativa";
  }

  async sincronizarAlunosComTratamento(): Promise<void> {
    try {
      const resposta = await this.cloud.sincronizarAlunos();
      if (resposta.error) throw new Error(resposta.error);
      await this.alunosCache.substituirTodos(resposta.alunos ?? []);
      logger.info({ total: resposta.alunos?.length ?? 0 }, "Cache local de alunos sincronizado com a nuvem");
      this.setStatus("online");
      await this.flushLogsPendentes();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Falha ao sincronizar a lista de alunos com a nuvem");
    }
  }

  async flushLogsPendentes(): Promise<void> {
    const pendentes = await this.logsQueue.listarPendentes();
    if (pendentes.length === 0) return;

    try {
      await this.cloud.sincronizarLogsOffline(
        pendentes.map((p) => ({
          aluno_id: p.aluno_id,
          cpf_consultado: p.cpf_consultado,
          resultado: p.resultado,
          ocorrido_em: p.ocorrido_em,
          ...(p.giro ? { giro: p.giro } : {}),
        }))
      );
      await this.logsQueue.marcarSincronizados(pendentes.map((p) => p._id));
      logger.info({ total: pendentes.length }, "Logs offline sincronizados com a nuvem");
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Falha ao sincronizar logs offline — tentando de novo mais tarde");
    }
  }
}

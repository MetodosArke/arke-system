import axios, { type AxiosInstance } from "axios";
import type {
  Credencial,
  GatewayConfig,
  Giro,
  RespostaComandosCloud,
  RespostaSincronizarAlunosCloud,
  RespostaValidarAcessoCloud,
  ResultadoComando,
  TelemetriaGateway,
} from "../types";

/** Um acesso decidido na contingência, do jeito que sobe para a nuvem. */
export type LogOfflineCloud = {
  aluno_id: string | null;
  cpf_consultado: string;
  resultado: string;
  ocorrido_em: string;
  giro?: Giro | "pendente";
};

export type OpcoesSincronizacao = {
  /** `sincronizado_em` da última sincronização: pede só a diferença. */
  desde?: string;
  /** Força a lista inteira. */
  completo?: boolean;
};

export type OpcoesValidacao = {
  /** A catraca vai confirmar o giro depois; o registro nasce pendente. */
  aguardarGiro?: boolean;
};

/**
 * Interface do cliente da nuvem — o GatewayService depende disto (não da
 * classe concreta), para que os testes possam injetar um fake sem
 * precisar mockar axios/HTTP.
 */
export interface ICloudClient {
  validarAcesso(cpf: string): Promise<RespostaValidarAcessoCloud>;
  /** Validação por credencial tipada — o caminho da biometria passa por aqui. */
  validarCredencial?(credencial: Credencial, opcoes?: OpcoesValidacao): Promise<RespostaValidarAcessoCloud>;
  /** Fecha o giro de um acesso liberado online. */
  confirmarGiro?(logId: string, giro: Giro): Promise<{ atualizado: number }>;
  sincronizarAlunos(opcoes?: OpcoesSincronizacao): Promise<RespostaSincronizarAlunosCloud>;
  sincronizarLogsOffline(
    logs: LogOfflineCloud[]
  ): Promise<{ inseridos: number }>;
}

export type PedidoCanalComandos = {
  resultados: ResultadoComando[];
  telemetria: TelemetriaGateway;
  /** Quanto a nuvem pode segurar a resposta esperando ordem nova. */
  aguardarMs: number;
};

/** Canal de ida e volta com a nuvem (catraca-comandos). Separado para os testes injetarem um fake. */
export interface ICanalComandos {
  trocar(pedido: PedidoCanalComandos): Promise<RespostaComandosCloud>;
}

/**
 * Cliente HTTP para as Edge Functions do ARKE® Gateway Local no Supabase.
 * Autenticação é feita via `device_token` (aqui chamado token_api_local no
 * config.json, mesmo valor), embutido no corpo de cada requisição — não é
 * um JWT de usuário, essas funções rodam com verify_jwt desabilitado e
 * validam o dispositivo internamente.
 */
export class CloudClient implements ICloudClient, ICanalComandos {
  private readonly http: AxiosInstance;
  private readonly token: string;

  constructor(config: Pick<GatewayConfig, "supabase_url" | "token_api_local" | "tempo_timeout_ms">) {
    this.token = config.token_api_local;
    this.http = axios.create({
      baseURL: `${config.supabase_url.replace(/\/$/, "")}/functions/v1`,
      timeout: config.tempo_timeout_ms,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * POST /catraca-validar-acesso — alvo de latência: responder dentro do
   * timeout configurado (padrão 1000 ms — ver config.ts). Deixa o timeout do axios estourar
   * naturalmente; quem decide o fallback offline é o chamador
   * (GatewayService), não este cliente.
   */
  async validarAcesso(cpf: string): Promise<RespostaValidarAcessoCloud> {
    return this.validarCredencial({ tipo: "cpf", valor: cpf });
  }

  /**
   * Manda ou `cpf` ou `identificador_catraca` — nunca os dois. A Edge
   * Function resolve o aluno pela chave que vier; mandar as duas abriria
   * espaço para elas discordarem, e aí a catraca decide por desempate
   * acidental em vez de por regra.
   */
  async validarCredencial(credencial: Credencial, opcoes: OpcoesValidacao = {}): Promise<RespostaValidarAcessoCloud> {
    const corpo =
      credencial.tipo === "cpf"
        ? { cpf: credencial.valor }
        : { identificador_catraca: credencial.valor };

    const { data } = await this.http.post<RespostaValidarAcessoCloud>("/catraca-validar-acesso", {
      device_token: this.token,
      ...corpo,
      ...(opcoes.aguardarGiro ? { aguardar_giro: true } : {}),
    });
    return data;
  }

  /**
   * POST /catraca-confirmar-giro. Fora do timeout curto da validação: a
   * catraca já girou, ninguém está esperando na frente dela, e perder esta
   * chamada por pressa custaria a presença do aluno.
   */
  async confirmarGiro(logId: string, giro: Giro): Promise<{ atualizado: number }> {
    const { data } = await this.http.post<{ atualizado?: number; error?: string }>(
      "/catraca-confirmar-giro",
      { device_token: this.token, log_id: logId, giro },
      { timeout: 10_000 }
    );
    if (data.error) throw new Error(data.error);
    return { atualizado: data.atualizado ?? 0 };
  }

  /** POST /catraca-sincronizar-alunos — atualiza o cache offline local. */
  async sincronizarAlunos(opcoes: OpcoesSincronizacao = {}): Promise<RespostaSincronizarAlunosCloud> {
    const { data } = await this.http.post<RespostaSincronizarAlunosCloud>(
      "/catraca-sincronizar-alunos",
      {
        device_token: this.token,
        ...(opcoes.desde ? { desde: opcoes.desde } : {}),
        ...(opcoes.completo ? { completo: true } : {}),
      },
      // A lista inteira de uma academia grande não cabe no timeout curto da
      // validação de acesso; ninguém está esperando na catraca por ela.
      { timeout: 15_000 }
    );
    return data;
  }

  /**
   * POST /catraca-sincronizar-logs-offline — envia em lote os acessos
   * decididos localmente enquanto a internet estava fora.
   */
  async sincronizarLogsOffline(
    logs: LogOfflineCloud[]
  ): Promise<{ inseridos: number }> {
    const { data } = await this.http.post<{ inseridos: number; error?: string }>(
      "/catraca-sincronizar-logs-offline",
      { device_token: this.token, logs }
    );
    if (data.error) throw new Error(data.error);
    return { inseridos: data.inseridos ?? 0 };
  }

  /**
   * POST /catraca-comandos — leva resultados e telemetria, traz ordens. A
   * nuvem segura a resposta por até `aguardarMs` esperando ordem nova
   * (escuta longa), então o timeout daqui é essa espera mais a folga da
   * rede, e não o timeout curto da validação.
   */
  async trocar(pedido: PedidoCanalComandos): Promise<RespostaComandosCloud> {
    const { data } = await this.http.post<RespostaComandosCloud>(
      "/catraca-comandos",
      {
        device_token: this.token,
        resultados: pedido.resultados,
        telemetria: pedido.telemetria,
        aguardar_ms: pedido.aguardarMs,
      },
      { timeout: pedido.aguardarMs + 15_000 }
    );
    if (data?.error) throw new Error(data.error);
    return data ?? {};
  }
}

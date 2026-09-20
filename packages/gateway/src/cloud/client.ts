import axios, { type AxiosInstance } from "axios";
import type {
  Credencial,
  GatewayConfig,
  RespostaSincronizarAlunosCloud,
  RespostaValidarAcessoCloud,
} from "../types";

/**
 * Interface do cliente da nuvem — o GatewayService depende disto (não da
 * classe concreta), para que os testes possam injetar um fake sem
 * precisar mockar axios/HTTP.
 */
export interface ICloudClient {
  validarAcesso(cpf: string): Promise<RespostaValidarAcessoCloud>;
  /** Validação por credencial tipada — o caminho da biometria passa por aqui. */
  validarCredencial?(credencial: Credencial): Promise<RespostaValidarAcessoCloud>;
  sincronizarAlunos(): Promise<RespostaSincronizarAlunosCloud>;
  sincronizarLogsOffline(
    logs: { aluno_id: string | null; cpf_consultado: string; resultado: string; ocorrido_em: string }[]
  ): Promise<{ inseridos: number }>;
}

/**
 * Cliente HTTP para as Edge Functions do ARKE® Gateway Local no Supabase.
 * Autenticação é feita via `device_token` (aqui chamado token_api_local no
 * config.json, mesmo valor), embutido no corpo de cada requisição — não é
 * um JWT de usuário, essas funções rodam com verify_jwt desabilitado e
 * validam o dispositivo internamente.
 */
export class CloudClient implements ICloudClient {
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
   * timeout configurado (padrão 300ms). Deixa o timeout do axios estourar
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
  async validarCredencial(credencial: Credencial): Promise<RespostaValidarAcessoCloud> {
    const corpo =
      credencial.tipo === "cpf"
        ? { cpf: credencial.valor }
        : { identificador_catraca: credencial.valor };

    const { data } = await this.http.post<RespostaValidarAcessoCloud>("/catraca-validar-acesso", {
      device_token: this.token,
      ...corpo,
    });
    return data;
  }

  /** POST /catraca-sincronizar-alunos — atualiza o cache offline local. */
  async sincronizarAlunos(): Promise<RespostaSincronizarAlunosCloud> {
    const { data } = await this.http.post<RespostaSincronizarAlunosCloud>("/catraca-sincronizar-alunos", {
      device_token: this.token,
    });
    return data;
  }

  /**
   * POST /catraca-sincronizar-logs-offline — envia em lote os acessos
   * decididos localmente enquanto a internet estava fora.
   */
  async sincronizarLogsOffline(
    logs: { aluno_id: string | null; cpf_consultado: string; resultado: string; ocorrido_em: string }[]
  ): Promise<{ inseridos: number }> {
    const { data } = await this.http.post<{ inseridos: number; error?: string }>(
      "/catraca-sincronizar-logs-offline",
      { device_token: this.token, logs }
    );
    if (data.error) throw new Error(data.error);
    return { inseridos: data.inseridos ?? 0 };
  }
}

import type {
  ICloudClient,
  LogOfflineCloud,
  OpcoesSincronizacao,
  OpcoesValidacao,
  RespostaLogsOffline,
} from "../../src/cloud/client";
import type { Credencial, Giro, RespostaSincronizarAlunosCloud, RespostaValidarAcessoCloud } from "../../src/types";

/**
 * Fake do cliente da nuvem para os testes — sem axios, sem rede. Cada
 * teste configura o comportamento desejado via os campos públicos.
 */
export class FakeCloudClient implements ICloudClient {
  respostaValidarAcesso: RespostaValidarAcessoCloud | null = null;
  erroValidarAcesso: Error | null = null;

  respostaSincronizarAlunos: RespostaSincronizarAlunosCloud = { alunos: [] };
  /**
   * Resposta a um pedido de lista inteira (`completo: true`). Sem ela, vale
   * `respostaSincronizarAlunos` para todo pedido.
   */
  respostaSincronizarCompleto: RespostaSincronizarAlunosCloud | null = null;
  /** O que o gateway pediu em cada sincronização, na ordem. */
  pedidosSincronizacao: OpcoesSincronizacao[] = [];

  logsRecebidos: LogOfflineCloud[] = [];

  /** Opções de cada validação, para conferir se o gateway pediu para aguardar o giro. */
  opcoesRecebidas: OpcoesValidacao[] = [];
  /** Giros confirmados, na ordem em que chegaram. */
  girosConfirmados: { logId: string; giro: Giro }[] = [];
  erroConfirmarGiro: Error | null = null;
  erroSincronizarLogs: Error | null = null;

  /** Guarda o que foi pedido, para os testes afirmarem QUAL credencial chegou à nuvem. */
  credenciaisRecebidas: Credencial[] = [];

  async validarAcesso(cpf: string): Promise<RespostaValidarAcessoCloud> {
    return this.validarCredencial({ tipo: "cpf", valor: cpf });
  }

  async validarCredencial(credencial: Credencial, opcoes: OpcoesValidacao = {}): Promise<RespostaValidarAcessoCloud> {
    this.credenciaisRecebidas.push(credencial);
    this.opcoesRecebidas.push(opcoes);
    if (this.erroValidarAcesso) throw this.erroValidarAcesso;
    if (!this.respostaValidarAcesso) throw new Error("FakeCloudClient: respostaValidarAcesso não configurada");
    return this.respostaValidarAcesso;
  }

  async sincronizarAlunos(opcoes: OpcoesSincronizacao = {}): Promise<RespostaSincronizarAlunosCloud> {
    this.pedidosSincronizacao.push(opcoes);
    if (opcoes.completo && this.respostaSincronizarCompleto) return this.respostaSincronizarCompleto;
    return this.respostaSincronizarAlunos;
  }

  async confirmarGiro(logId: string, giro: Giro): Promise<{ atualizado: number }> {
    if (this.erroConfirmarGiro) throw this.erroConfirmarGiro;
    this.girosConfirmados.push({ logId, giro });
    return { atualizado: 1 };
  }

  /**
   * Como a nuvem responde ao lote de acessos offline. `por_registro` é a
   * nuvem de 06/10/2026 em diante (diz o que fez com cada `id_local`);
   * `antiga` só conta os inseridos.
   */
  modoLogs: "por_registro" | "antiga" = "por_registro";
  /** Registro que a nuvem recusa de vez, com o motivo (null: aceita). */
  descartarLog: (log: LogOfflineCloud) => string | null = () => null;
  /** Registro que a nuvem não chegou a tratar (fica fora das duas listas). */
  deixarDeFora: (log: LogOfflineCloud) => boolean = () => false;

  async sincronizarLogsOffline(logs: LogOfflineCloud[]): Promise<RespostaLogsOffline> {
    if (this.erroSincronizarLogs) throw this.erroSincronizarLogs;
    if (this.modoLogs === "antiga") {
      this.logsRecebidos.push(...logs);
      return { inseridos: logs.length };
    }
    const aceitos: string[] = [];
    const descartados: { id_local: string | null; motivo: string }[] = [];
    for (const l of logs) {
      if (this.deixarDeFora(l)) continue;
      const motivo = this.descartarLog(l);
      if (motivo) descartados.push({ id_local: l.id_local ?? null, motivo });
      else {
        this.logsRecebidos.push(l);
        if (l.id_local) aceitos.push(l.id_local);
      }
    }
    return { inseridos: aceitos.length, aceitos, descartados };
  }
}

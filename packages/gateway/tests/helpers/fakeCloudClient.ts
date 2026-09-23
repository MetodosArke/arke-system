import type { ICloudClient, LogOfflineCloud, OpcoesValidacao } from "../../src/cloud/client";
import type { Credencial, Giro, RespostaSincronizarAlunosCloud, RespostaValidarAcessoCloud } from "../../src/types";

/**
 * Fake do cliente da nuvem para os testes — sem axios, sem rede. Cada
 * teste configura o comportamento desejado via os campos públicos.
 */
export class FakeCloudClient implements ICloudClient {
  respostaValidarAcesso: RespostaValidarAcessoCloud | null = null;
  erroValidarAcesso: Error | null = null;

  respostaSincronizarAlunos: RespostaSincronizarAlunosCloud = { alunos: [] };

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

  async sincronizarAlunos(): Promise<RespostaSincronizarAlunosCloud> {
    return this.respostaSincronizarAlunos;
  }

  async confirmarGiro(logId: string, giro: Giro): Promise<{ atualizado: number }> {
    if (this.erroConfirmarGiro) throw this.erroConfirmarGiro;
    this.girosConfirmados.push({ logId, giro });
    return { atualizado: 1 };
  }

  async sincronizarLogsOffline(logs: LogOfflineCloud[]): Promise<{ inseridos: number }> {
    if (this.erroSincronizarLogs) throw this.erroSincronizarLogs;
    this.logsRecebidos.push(...logs);
    return { inseridos: logs.length };
  }
}

import type { ICloudClient } from "../../src/cloud/client";
import type { RespostaSincronizarAlunosCloud, RespostaValidarAcessoCloud } from "../../src/types";

/**
 * Fake do cliente da nuvem para os testes — sem axios, sem rede. Cada
 * teste configura o comportamento desejado via os campos públicos.
 */
export class FakeCloudClient implements ICloudClient {
  respostaValidarAcesso: RespostaValidarAcessoCloud | null = null;
  erroValidarAcesso: Error | null = null;

  respostaSincronizarAlunos: RespostaSincronizarAlunosCloud = { alunos: [] };

  logsRecebidos: { aluno_id: string | null; cpf_consultado: string; resultado: string; ocorrido_em: string }[] = [];
  erroSincronizarLogs: Error | null = null;

  async validarAcesso(_cpf: string): Promise<RespostaValidarAcessoCloud> {
    if (this.erroValidarAcesso) throw this.erroValidarAcesso;
    if (!this.respostaValidarAcesso) throw new Error("FakeCloudClient: respostaValidarAcesso não configurada");
    return this.respostaValidarAcesso;
  }

  async sincronizarAlunos(): Promise<RespostaSincronizarAlunosCloud> {
    return this.respostaSincronizarAlunos;
  }

  async sincronizarLogsOffline(
    logs: { aluno_id: string | null; cpf_consultado: string; resultado: string; ocorrido_em: string }[]
  ): Promise<{ inseridos: number }> {
    if (this.erroSincronizarLogs) throw this.erroSincronizarLogs;
    this.logsRecebidos.push(...logs);
    return { inseridos: logs.length };
  }
}

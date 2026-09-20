import type { ICloudClient } from "../../src/cloud/client";
import type { Credencial, RespostaSincronizarAlunosCloud, RespostaValidarAcessoCloud } from "../../src/types";

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

  /** Guarda o que foi pedido, para os testes afirmarem QUAL credencial chegou à nuvem. */
  credenciaisRecebidas: Credencial[] = [];

  async validarAcesso(cpf: string): Promise<RespostaValidarAcessoCloud> {
    return this.validarCredencial({ tipo: "cpf", valor: cpf });
  }

  async validarCredencial(credencial: Credencial): Promise<RespostaValidarAcessoCloud> {
    this.credenciaisRecebidas.push(credencial);
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

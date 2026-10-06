import path from "node:path";
import Datastore from "nedb-promises";
import type { LogAcessoPendente } from "../types";
import { compactarArquivo } from "./compactar";

interface LogDoc extends LogAcessoPendente {
  _id?: string;
}

/** Quanto um acesso já entregue à nuvem fica no computador da recepção. */
export const DIAS_GUARDANDO_SINCRONIZADOS = 30;

/**
 * Fila local (NeDB) dos acessos validados offline, aguardando envio em
 * lote para catraca-sincronizar-logs-offline assim que a internet volta.
 * Nada aqui sai da fila até a nuvem dizer o que fez com ele — aceitou ou
 * recusou de vez. Se a sincronização falhar a meio caminho, os registros
 * continuam pendentes e são reenviados na próxima tentativa.
 *
 * Cada registro guarda o CPF digitado ou o número do aluno e o horário, no
 * computador da recepção. Por isso o que já subiu não fica para sempre:
 * sai depois de `DIAS_GUARDANDO_SINCRONIZADOS` (`limparAntigos`), e o
 * arquivo é reescrito, porque o NeDB só acrescenta linhas e a exclusão
 * deixaria o registro antigo no disco.
 */
export class LogsQueue {
  private readonly db: Datastore<LogDoc>;

  constructor(dataDir: string) {
    // Ver o comentário equivalente em alunosCache.ts sobre não usar
    // `autoload: true` aqui.
    this.db = Datastore.create({
      filename: path.join(dataDir, "logs-pendentes.db"),
    });
  }

  /** Devolve o id local, para o giro poder ser fechado depois. */
  async adicionar(log: LogAcessoPendente): Promise<string> {
    const doc = await this.db.insert(log);
    return doc._id as string;
  }

  /**
   * Fecha o giro de um acesso da contingência que ainda não subiu. Se já
   * subiu, não há o que fazer daqui: a nuvem fecha os giros que ficarem
   * pendentes (fechar_giros_pendentes) como sem confirmação.
   */
  async fecharGiro(id: string, giro: LogAcessoPendente["giro"]): Promise<boolean> {
    const n = await this.db.update({ _id: id, sincronizado: false }, { $set: { giro } });
    return n > 0;
  }

  async listarPendentes(limite = 500): Promise<(LogAcessoPendente & { _id: string })[]> {
    const docs = await this.db.find({ sincronizado: false }).sort({ ocorrido_em: 1 }).limit(limite);
    return docs as (LogAcessoPendente & { _id: string })[];
  }

  async marcarSincronizados(ids: string[], agora: Date = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update(
      { _id: { $in: ids } },
      { $set: { sincronizado: true, sincronizado_em: agora.toISOString() } },
      { multi: true }
    );
  }

  /**
   * Registros que a nuvem recusou de vez (aluno que não é da academia, data
   * fora da janela, dado torto). Saem da fila, senão voltariam à frente dela
   * a cada envio e travariam os que vêm atrás; ficam marcados com o motivo
   * pelo mesmo prazo dos aceitos, para o técnico entender o que houve.
   */
  async marcarDescartados(descartados: { id: string; motivo: string }[], agora: Date = new Date()): Promise<void> {
    for (const d of descartados) {
      await this.db.update(
        { _id: d.id },
        { $set: { sincronizado: true, sincronizado_em: agora.toISOString(), descartado: d.motivo.slice(0, 120) } }
      );
    }
  }

  async contarPendentes(): Promise<number> {
    return this.db.count({ sincronizado: false });
  }

  /** Quantos registros o arquivo guarda, pendentes ou não (para os testes e o diagnóstico). */
  async contarTodos(): Promise<number> {
    return this.db.count({});
  }

  /**
   * Apaga do computador da recepção o que já subiu há mais de `dias` e
   * reescreve o arquivo. Registro de antes da 1.9 não tem `sincronizado_em`:
   * vale a hora do acesso, que é mais antiga.
   */
  async limparAntigos(dias = DIAS_GUARDANDO_SINCRONIZADOS, agora: Date = new Date()): Promise<number> {
    const corte = agora.getTime() - dias * 24 * 3600_000;
    const entregues = await this.db.find({ sincronizado: true });
    const velhos = entregues
      .filter((d) => {
        const quando = Date.parse(d.sincronizado_em ?? d.ocorrido_em);
        return Number.isNaN(quando) || quando < corte;
      })
      .map((d) => d._id as string);
    if (velhos.length === 0) return 0;
    const n = await this.db.remove({ _id: { $in: velhos } }, { multi: true });
    await compactarArquivo(this.db);
    return n;
  }
}

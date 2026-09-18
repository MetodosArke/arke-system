import path from "node:path";
import Datastore from "nedb-promises";
import type { LogAcessoPendente } from "../types";

interface LogDoc extends LogAcessoPendente {
  _id?: string;
}

/**
 * Fila local (NeDB) dos acessos validados offline, aguardando envio em
 * lote para catraca-sincronizar-logs-offline assim que a internet volta.
 * Nada aqui é apagado até a nuvem confirmar a inserção — se a
 * sincronização falhar a meio caminho, os logs continuam pendentes e são
 * reenviados na próxima tentativa.
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

  async adicionar(log: LogAcessoPendente): Promise<void> {
    await this.db.insert(log);
  }

  async listarPendentes(limite = 500): Promise<(LogAcessoPendente & { _id: string })[]> {
    const docs = await this.db.find({ sincronizado: false }).sort({ ocorrido_em: 1 }).limit(limite);
    return docs as (LogAcessoPendente & { _id: string })[];
  }

  async marcarSincronizados(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update({ _id: { $in: ids } }, { $set: { sincronizado: true } }, { multi: true });
  }

  async contarPendentes(): Promise<number> {
    return this.db.count({ sincronizado: false });
  }
}

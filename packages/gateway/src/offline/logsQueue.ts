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

  async marcarSincronizados(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.update({ _id: { $in: ids } }, { $set: { sincronizado: true } }, { multi: true });
  }

  async contarPendentes(): Promise<number> {
    return this.db.count({ sincronizado: false });
  }
}

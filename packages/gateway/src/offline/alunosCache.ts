import path from "node:path";
import Datastore from "nedb-promises";
import type { AlunoCache } from "../types";

interface AlunoCacheDoc extends AlunoCache {
  _id?: string;
}

/**
 * Cache local (NeDB — arquivo único, sem dependência nativa, tranquilo de
 * empacotar com pkg) da lista de alunos ativos da organização, usado para
 * validar acesso quando a nuvem está fora do ar ou responde acima do
 * timeout configurado.
 */
export class AlunosCache {
  private readonly db: Datastore<AlunoCacheDoc>;

  constructor(dataDir: string) {
    // Sem `autoload: true` de propósito: a lib nedb-promises já aguarda o
    // carregamento do arquivo antes de qualquer operação (insert/find/...),
    // e `autoload` dispararia um segundo carregamento em segundo plano no
    // nedb original por baixo, sem ninguém aguardando essa promise.
    this.db = Datastore.create({
      filename: path.join(dataDir, "alunos-cache.db"),
    });
  }

  /** Substitui todo o cache pela lista mais recente vinda da nuvem. */
  async substituirTodos(alunos: AlunoCache[]): Promise<void> {
    await this.db.remove({}, { multi: true });
    if (alunos.length > 0) {
      await this.db.insert(alunos);
    }
  }

  async buscarPorCpf(cpf: string): Promise<AlunoCache | null> {
    const doc = await this.db.findOne({ cpf });
    return doc ?? null;
  }

  async contar(): Promise<number> {
    return this.db.count({});
  }
}

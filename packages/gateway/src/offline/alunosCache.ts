import path from "node:path";
import { createHash } from "node:crypto";
import Datastore from "nedb-promises";
import type { AlunoCache } from "../types";
import { compactarArquivo } from "./compactar";

interface AlunoCacheDoc extends AlunoCache {
  _id?: string;
}

/**
 * O que o cache guarda de cada aluno: o mínimo para decidir na queda de
 * internet. O nome não entra (a nuvem anterior a 06/10/2026 ainda o manda):
 * o display não o mostra, e o computador da recepção não precisa dele.
 */
function semNome({ nome: _nome, ...resto }: AlunoCache): AlunoCache {
  return resto;
}

/**
 * Cache local (NeDB — arquivo único, sem dependência nativa, tranquilo de
 * empacotar com pkg) da lista de alunos atuais da organização, usado para
 * validar acesso quando a nuvem está fora do ar ou responde acima do
 * timeout configurado.
 *
 * Só os alunos atuais: a nuvem tira da lista quem saiu (excluído,
 * anonimizado, matrícula encerrada), e cada mudança reescreve o arquivo
 * (`compactarArquivo`), para o CPF de quem saiu não ficar no disco.
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
      await this.db.insert(alunos.map(semNome));
    }
    await compactarArquivo(this.db);
  }

  async buscarPorCpf(cpf: string): Promise<AlunoCache | null> {
    const doc = await this.db.findOne({ cpf });
    return doc ?? null;
  }

  /**
   * Busca pelo número do usuário dentro do equipamento — o caminho da
   * biometria, onde a catraca identifica localmente e informa só o id.
   */
  async buscarPorIdentificador(identificador: string): Promise<AlunoCache | null> {
    const doc = await this.db.findOne({ identificador_catraca: identificador });
    return doc ?? null;
  }

  async contar(): Promise<number> {
    return this.db.count({});
  }

  /**
   * Quem tem número no equipamento e se está barrado: é o que o Gateway
   * espelha nos terminais que guardam a situação (Intelbras).
   */
  async comIdentificador(): Promise<{ identificador: string; barrado: boolean }[]> {
    const docs = await this.db.find({});
    return docs
      .filter((d) => d.identificador_catraca)
      .map((d) => ({ identificador: String(d.identificador_catraca), barrado: !!d.inadimplente }));
  }

  /**
   * Aplica a diferença vinda da nuvem: atualiza ou inclui os alterados e
   * tira os que deixaram de poder estar no cache. Por `aluno_id`, então
   * receber o mesmo aluno duas vezes (a nuvem sobrepõe dois minutos entre
   * sincronizações) é inofensivo.
   */
  async aplicarDiferenca(alterados: AlunoCache[], remover: string[]): Promise<void> {
    const ids = [...new Set([...alterados.map((a) => a.aluno_id), ...remover])];
    if (ids.length === 0) return;
    await this.db.remove({ aluno_id: { $in: ids } }, { multi: true });
    if (alterados.length) await this.db.insert(alterados.map(semNome));
    // A versão anterior de cada linha alterada, e a de quem saiu, continuam
    // no arquivo até ele ser reescrito.
    await compactarArquivo(this.db);
  }

  /**
   * Impressão digital do conjunto: md5 dos ids em ordem, separados por
   * vírgula — exatamente o que alunos_catraca_hash() calcula no banco. A
   * ordem do uuid no Postgres é a de bytes, que coincide com a ordem
   * lexicográfica do texto em minúsculas; por isso um sort() de strings
   * basta, sem depender de collation.
   */
  async hashIds(): Promise<string> {
    const docs = await this.db.find({}, { aluno_id: 1 });
    const ids = docs.map((d) => String(d.aluno_id).toLowerCase()).sort();
    return createHash("md5").update(ids.join(","), "utf8").digest("hex");
  }
}

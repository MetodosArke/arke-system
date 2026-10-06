// Apaga os arquivos de um aluno nos buckets privados organizados por
// <organização>/<aluno>/ (atestados, vídeos do chat, termo da digital).
//
// Excluir ou anonimizar o aluno apagava as linhas do banco e deixava os
// arquivos: atestado médico e vídeo de conversa — dado de saúde — sem nada
// apontando para eles, e sem ninguém que soubesse que existiam. Linha e
// arquivo são o mesmo dado; sair um sem o outro é resto, não exclusão.
//
// Nunca lança: a exclusão no banco já aconteceu quando isto roda, e falhar
// aqui não pode desfazê-la nem esconder o sucesso dela. O que não saiu volta
// no resultado, para a função avisar.

type ClienteStorage = {
  storage: {
    from: (bucket: string) => {
      list: (prefixo: string, opcoes?: { limit?: number }) => PromiseLike<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
      remove: (caminhos: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
};

/**
 * Caminho dentro do bucket a partir da URL pública do Storage
 * (`…/storage/v1/object/public/<bucket>/<caminho>`). Devolve null para
 * qualquer outra URL: o que não é deste Storage não é apagado daqui.
 */
export function caminhoDaUrlPublica(url: string): { bucket: string; caminho: string } | null {
  const m = /\/storage\/v1\/object\/public\/([^/?#]+)\/([^?#]+)/.exec(url);
  if (!m) return null;
  return { bucket: m[1], caminho: decodeURIComponent(m[2]) };
}

/**
 * Apaga arquivos de buckets públicos (fotos do feed, foto de perfil) pela URL
 * guardada no banco. Eles não ficam na pasta do aluno: a URL é o único rastro,
 * e um arquivo público esquecido continua aberto para quem tem o link.
 * Nunca lança, pelo mesmo motivo de `apagarArquivosDoAluno`.
 */
export async function apagarArquivosPorUrl(
  admin: ClienteStorage,
  urls: string[],
): Promise<{ apagados: number; falhas: string[] }> {
  const porBucket = new Map<string, string[]>();
  for (const url of urls) {
    const alvo = caminhoDaUrlPublica(url);
    if (!alvo) continue;
    porBucket.set(alvo.bucket, [...(porBucket.get(alvo.bucket) ?? []), alvo.caminho]);
  }
  let apagados = 0;
  const falhas: string[] = [];
  for (const [bucket, caminhos] of porBucket) {
    try {
      const { error } = await admin.storage.from(bucket).remove(caminhos);
      if (error) throw error;
      apagados += caminhos.length;
    } catch {
      falhas.push(bucket);
      console.error("arquivosDoAluno: não foi possível apagar", bucket);
    }
  }
  return { apagados, falhas };
}

export async function apagarArquivosDoAluno(
  admin: ClienteStorage,
  organizationId: string,
  alunoId: string,
  buckets: string[]
): Promise<{ apagados: number; falhas: string[] }> {
  let apagados = 0;
  const falhas: string[] = [];
  const pasta = `${organizationId}/${alunoId}`;
  for (const bucket of buckets) {
    try {
      const caminhos: string[] = [];
      const { data, error } = await admin.storage.from(bucket).list(pasta, { limit: 1000 });
      if (error) throw error;
      for (const item of data ?? []) {
        if (item.id) {
          caminhos.push(`${pasta}/${item.name}`);
        } else {
          // Subpasta (sem id): um nível basta para o que o app grava.
          const { data: dentro } = await admin.storage.from(bucket).list(`${pasta}/${item.name}`, { limit: 1000 });
          for (const d of dentro ?? []) if (d.id) caminhos.push(`${pasta}/${item.name}/${d.name}`);
        }
      }
      if (caminhos.length) {
        const { error: erroRemover } = await admin.storage.from(bucket).remove(caminhos);
        if (erroRemover) throw erroRemover;
        apagados += caminhos.length;
      }
    } catch {
      // Só o bucket vai para o resultado e para o log: o caminho tem o id do aluno.
      falhas.push(bucket);
      console.error("arquivosDoAluno: não foi possível apagar", bucket);
    }
  }
  return { apagados, falhas };
}

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

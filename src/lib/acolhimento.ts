/**
 * Envio da anamnese de acolhimento (M.A.P.A.®) sem sobrescrever a que existe.
 *
 * Até 06/10/2026 o envio era um `upsert` por aluno. Somado a uma leitura que
 * falhava ao abrir o app (o aluno com a anamnese pronta era tratado como sem
 * anamnese e mandado de volta ao acolhimento), o segundo envio trocava as
 * respostas que o mentor já tinha lido por outras.
 *
 * Agora: inclui. Se já há linha (a chave única é o aluno), só completa a que
 * ainda não foi concluída. A concluída fica como está.
 */
export type ResultadoEnvioAnamnese = "gravada" | "completada" | "ja_existia";

type ErroBanco = { code?: string; message: string } | null;

export interface GravadorAnamnese<Linha> {
  inserir(linha: Linha): PromiseLike<{ error: ErroBanco }>;
  /** Atualiza só se a anamnese do aluno ainda não foi concluída, devolvendo as linhas alteradas. */
  completarSeAberta(linha: Linha): PromiseLike<{ data: unknown[] | null; error: ErroBanco }>;
}

/** Violação de chave única no Postgres: já existe anamnese deste aluno. */
const JA_EXISTE = "23505";

export async function enviarAnamnese<Linha>(linha: Linha, gravador: GravadorAnamnese<Linha>): Promise<ResultadoEnvioAnamnese> {
  const { error: erroInclusao } = await gravador.inserir(linha);
  if (!erroInclusao) return "gravada";
  if (erroInclusao.code !== JA_EXISTE) throw erroInclusao;

  const { data, error } = await gravador.completarSeAberta(linha);
  if (error) throw error;
  return data && data.length > 0 ? "completada" : "ja_existia";
}

/**
 * Leitura do arquivo da importação de alunos com o encoding certo.
 *
 * A biblioteca de planilhas (SheetJS) lê CSV sem BOM como Windows-1252. É o
 * formato do Excel brasileiro, mas não o dos sistemas web: exportação em
 * UTF-8 sem BOM chegava com "João Conceição" virando "JoÃ£o ConceiÃ§Ã£o" em
 * todas as linhas, e a coluna "Situação" deixava de ser reconhecida. Por isso
 * o CSV é decodificado aqui antes de ir para a biblioteca: se os bytes são
 * UTF-8 válido, é UTF-8; se não, é Windows-1252. Um arquivo Windows-1252 com
 * acento quase nunca é UTF-8 válido por acaso — o "ã" (0xE3) seguido de uma
 * letra comum é uma sequência inválida —, então o teste é seguro.
 *
 * .xlsx e .xls são binários, com o encoding definido por dentro, e seguem
 * direto para a biblioteca.
 */

/** .xlsx é um zip ("PK"); .xls é um documento OLE (D0 CF 11 E0). */
export function ehPlanilhaBinaria(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
  );
}

/** Texto do CSV: UTF-8 quando os bytes são UTF-8 válido (com ou sem BOM), Windows-1252 quando não. */
export function decodificarTexto(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Linhas da primeira aba, com o cabeçalho como chave — o formato que a importação usa. */
export async function lerLinhasPlanilha(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  // Import dinâmico: mantém a biblioteca (pesada) fora do bundle principal,
  // carregada só quando alguém de fato importa.
  const { read, utils } = await import("xlsx");
  const bytes = new Uint8Array(buffer);
  const workbook = ehPlanilhaBinaria(bytes)
    ? read(bytes, { type: "array" })
    : read(decodificarTexto(bytes), { type: "string" });
  const primeiraAba = workbook.SheetNames[0];
  return utils.sheet_to_json<Record<string, string>>(workbook.Sheets[primeiraAba], { defval: "", raw: false });
}

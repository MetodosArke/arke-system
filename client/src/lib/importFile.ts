import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedImportFile = { headers: string[]; rows: Record<string, string>[] };

const DIACRITICS_RE = /[̀-ͯ]/g;

// Normaliza só maiúsculas/minúsculas, acentos e espaços nas bordas — as
// colunas ainda precisam bater com as chaves exatas que server/importacao.ts
// espera (nome, cpf, valor_mensal, etc.), documentadas no componente que usa
// este helper.
function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

// Início clássico de injeção de fórmula CSV/Excel (OWASP) — prefixa com
// aspas simples pra forçar texto se esse valor algum dia for reaberto numa
// planilha (exportação, download futuro). Campos numéricos não são
// afetados: o parseNumber do servidor já descarta qualquer caractere que
// não seja dígito/./,/-  na limpeza, então a aspa simples não sobrevive lá.
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;
function sanitizeCellValue(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

function rowsFromMatrix(matrix: unknown[][]): ParsedImportFile {
  const [headerRow, ...dataRows] = matrix;
  const headers = (headerRow ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  // Duas colunas que normalizam pro mesmo nome (acento/espaço/maiúscula
  // diferentes) faziam a segunda sobrescrever a primeira silenciosamente
  // em cada linha, sem nenhum aviso no preview ou no commit.
  const seen = new Set<string>();
  const duplicated = headers.filter((header) => { if (!header) return false; if (seen.has(header)) return true; seen.add(header); return false; });
  if (duplicated.length > 0) throw new Error(`Colunas duplicadas no cabeçalho (mesma coluna após normalizar acentos/espaços): ${Array.from(new Set(duplicated)).join(", ")}.`);
  // Linhas em branco não são mais descartadas aqui — descartar antes de
  // mapear desalinhava o índice de cada linha sobrevivente do número real
  // dela no arquivo, e esse índice é o que server/importacao.ts usa para
  // reportar "Linha N: ..." no preview de erro. Cada validador no servidor
  // agora ignora silenciosamente uma linha inteiramente vazia, então o
  // alinhamento pode ficar intacto até lá.
  const rows = dataRows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { if (header) record[header] = sanitizeCellValue(String(row[index] ?? "").trim()); });
    return record;
  });
  return { headers, rows };
}

function parseCsv(file: File): Promise<ParsedImportFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      // false (não pula linha em branco aqui): ver comentário em
      // rowsFromMatrix sobre por que o alinhamento de linha precisa
      // sobreviver até o servidor.
      skipEmptyLines: false,
      complete: (result) => resolve(rowsFromMatrix(result.data)),
      error: (error) => reject(error),
    });
  });
}

async function parseXlsx(file: File): Promise<ParsedImportFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true, defval: "" });
  return rowsFromMatrix(matrix);
}

export function parseImportFile(file: File): Promise<ParsedImportFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(file);
  return Promise.reject(new Error("Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls."));
}

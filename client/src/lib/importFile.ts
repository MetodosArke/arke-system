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

function rowsFromMatrix(matrix: unknown[][]): ParsedImportFile {
  const [headerRow, ...dataRows] = matrix;
  const headers = (headerRow ?? []).map((cell) => normalizeHeader(String(cell ?? "")));
  const rows = dataRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => { if (header) record[header] = String(row[index] ?? "").trim(); });
      return record;
    });
  return { headers, rows };
}

function parseCsv(file: File): Promise<ParsedImportFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => resolve(rowsFromMatrix(result.data)),
      error: (error) => reject(error),
    });
  });
}

async function parseXlsx(file: File): Promise<ParsedImportFile> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  return rowsFromMatrix(matrix);
}

export function parseImportFile(file: File): Promise<ParsedImportFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(file);
  return Promise.reject(new Error("Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls."));
}

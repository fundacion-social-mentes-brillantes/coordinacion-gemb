import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Lectura de archivos CSV/XLSX para el importador de personas, con
// limpieza automática de "mojibake" (texto corrupto por mala codificación).

/**
 * Corrige mojibake típico de UTF-8 mal interpretado como Latin-1.
 * Ej.: "JosÃ©" -> "José", "RendÃ³n" -> "Rendón".
 * Solo actúa si el resultado es UTF-8 válido, para no dañar texto correcto.
 */
export function fixMojibake(input: string): string {
  if (!input) return input;
  // Señales sospechosas de mojibake (Ã Â â€ y BOM ï»¿), por código para
  // que la detección no dependa de la codificación del propio archivo fuente.
  const MOJIBAKE_SIGNS = new RegExp(
    '[\\u00c3\\u00c2]|\\u00e2\\u20ac|\\u00ef\\u00bb\\u00bf',
  );
  if (!MOJIBAKE_SIGNS.test(input)) return input;
  // Si hay caracteres fuera de Latin-1 no arriesgamos la reinterpretación.
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) > 255) return input;
  }
  try {
    const bytes = Uint8Array.from(Array.from(input, (c) => c.charCodeAt(0)));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded;
  } catch {
    return input; // no era mojibake recuperable
  }
}

function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return fixMojibake(String(v)).trim();
}

export interface RawTable {
  matrix: string[][]; // todas las filas y celdas (texto ya limpio)
  guessedHeader: boolean; // ¿la primera fila parece un encabezado?
}

const HEADER_HINT = /(nombre|apellido|name|correo|email|tel|celular|alias|nota|documento|cedula)/i;

function guessHeader(firstRow: string[]): boolean {
  return firstRow.some((c) => HEADER_HINT.test(c));
}

/** Lee un CSV respetando la codificación (UTF-8 o Windows-1252). */
async function readCsv(file: File): Promise<RawTable> {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  // Si aparece el carácter de reemplazo (U+FFFD), probablemente es Windows-1252.
  const REPLACEMENT = String.fromCharCode(0xfffd);
  if (text.includes(REPLACEMENT)) {
    try {
      text = new TextDecoder('windows-1252').decode(buf);
    } catch {
      /* nos quedamos con el UTF-8 */
    }
  }
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  });
  const matrix = (parsed.data as unknown as string[][])
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((c) => c !== ''));
  return { matrix, guessedHeader: matrix.length > 0 && guessHeader(matrix[0]) };
}

/** Lee la primera hoja de un XLSX/XLS. */
async function readXlsx(file: File): Promise<RawTable> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });
  const matrix = (rows as unknown as unknown[][])
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some((c) => c !== ''));
  return { matrix, guessedHeader: matrix.length > 0 && guessHeader(matrix[0]) };
}

export async function readTable(file: File): Promise<RawTable> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return readXlsx(file);
  return readCsv(file);
}

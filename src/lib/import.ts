import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Lectura de archivos CSV/XLSX para el importador de personas, con
// limpieza automática de "mojibake" (texto corrupto por mala codificación).

// Windows-1252 pone caracteres "tipográficos" en los bytes 0x80–0x9F. Cuando
// un texto UTF-8 se lee como Windows-1252, esos bytes salen como estos
// caracteres: para recuperar el byte original hay que deshacer la tabla.
// Sin ella, "MUÑOZ" (que llega como "MUÃ‘OZ": la Ñ tiene el byte 0x91) no se
// reparaba, y lo mismo Ó (0x93), É (0x89), Ú (0x9A) o el apóstrofo.
const CP1252_A_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Corrige mojibake típico de UTF-8 mal interpretado como Latin-1 o
 * Windows-1252. Ej.: "JosÃ©" -> "José", "RendÃ³n" -> "Rendón",
 * "MUÃ‘OZ" -> "MUÑOZ".
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
  // Cada carácter vuelve a su byte: Latin-1 tal cual, y los de la tabla de
  // Windows-1252 por su byte. Si aparece otro, no era mojibake: no se toca.
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c <= 0xff) bytes[i] = c;
    else if (CP1252_A_BYTE[c] !== undefined) bytes[i] = CP1252_A_BYTE[c];
    else return input;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
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

// Utilidades de normalización de texto para la búsqueda y el guardado.
import { UNKNOWN_PREFIX } from './constants';

// Rango de marcas diacríticas combinantes (acentos, tildes, diéresis...).
// Se construye desde una cadena escapada para no tener caracteres combinantes
// "sueltos" en el código fuente.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Normaliza texto para búsqueda:
 * - quita acentos/diacríticos (normalize NFD + rango de combinantes)
 * - pasa a minúsculas
 * - elimina signos raros
 * - colapsa espacios
 * Ej.: "José  Rendón" -> "jose rendon"
 */
export function normalizeText(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // deja letras/números/espacios
    .replace(/\s+/g, ' ')
    .trim();
}

/** Divide en tokens normalizados (para búsqueda por varios términos). */
export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(' ') : [];
}

// Palabras que en un nombre van en minúscula (salvo al principio).
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von']);

/**
 * Ordena las mayúsculas de un nombre: "miriam sabogal" → "Miriam Sabogal",
 * "MARIA DE LOS ANGELES" → "Maria de los Angeles".
 *
 * Solo toca las palabras escritas TODO en minúscula o TODO en mayúscula:
 * lo que ya viene con mayúsculas a propósito ("McDonald", "DiMaria") se
 * respeta. En el celular el teclado solo pone mayúscula a la primera palabra,
 * y así quedaban fichas como "Miriam sabogal" junto a "Miriam Sabogal".
 */
export function tidyName(raw: string): string {
  const limpio = (raw || '').trim().replace(/\s+/g, ' ');
  // "Por identificar (seña)" se reconoce por ese texto exacto: no se toca.
  if (limpio.startsWith(UNKNOWN_PREFIX)) return limpio;
  const palabras = limpio.split(' ').filter(Boolean);
  return palabras
    .map((w, i) => {
      const uniforme = w === w.toLowerCase() || (w === w.toUpperCase() && w.length > 1);
      if (!uniforme) return w;
      const lower = w.toLocaleLowerCase('es');
      if (i > 0 && CONECTORES.has(lower)) return lower;
      // Respeta guiones: "maria-jose" → "Maria-Jose".
      return lower.replace(/(^|-)(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('es'));
    })
    .join(' ');
}

/**
 * A partir de un nombre completo genera las partes que guardamos.
 * En español el apellido es ambiguo; para display tomamos la 1ª palabra como
 * "nombre" y el resto como "apellido". La búsqueda usa `searchName` completo.
 */
export function buildNameParts(fullNameRaw: string) {
  const fullName = tidyName(fullNameRaw);
  const parts = fullName.split(' ').filter(Boolean);
  const firstName = parts[0] ?? '';
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
  return {
    fullName,
    firstName,
    lastName,
    searchName: normalizeText(fullName),
  };
}

// Utilidades de normalización de texto para la búsqueda y el guardado.

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

/**
 * A partir de un nombre completo genera las partes que guardamos.
 * En español el apellido es ambiguo; para display tomamos la 1ª palabra como
 * "nombre" y el resto como "apellido". La búsqueda usa `searchName` completo.
 */
export function buildNameParts(fullNameRaw: string) {
  const fullName = (fullNameRaw || '').trim().replace(/\s+/g, ' ');
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

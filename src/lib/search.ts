import Fuse from 'fuse.js';
import type { Member } from '../types';
import { normalizeText, tokenize } from './normalize';

// Búsqueda difusa de personas: por nombre/apellido en cualquier orden,
// parcial, sin tildes, tolerando pequeños errores de tipeo.

export interface SearchableMember extends Member {
  _search: string; // searchName (respaldo)
  _aliasSearch: string; // alias normalizados unidos
}

export function toSearchable(members: Member[]): SearchableMember[] {
  return members.map((m) => ({
    ...m,
    _search: m.searchName || normalizeText(m.fullName),
    _aliasSearch: (m.aliases || []).map(normalizeText).join(' '),
  }));
}

export function buildFuse(members: SearchableMember[]) {
  return new Fuse(members, {
    includeScore: true,
    ignoreLocation: true, // el término puede aparecer en cualquier parte
    threshold: 0.4, // tolerante a errores de tipeo
    minMatchCharLength: 2,
    keys: [
      { name: '_search', weight: 0.7 },
      { name: '_aliasSearch', weight: 0.3 },
    ],
  });
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

/**
 * Busca requiriendo que TODOS los términos coincidan (AND por tokens).
 * Ej.: "jo ren" -> personas cuyo texto contiene algo parecido a "jo" Y a "ren".
 *
 * Si nadie coincide con todos y se escribieron varias palabras, devuelve las
 * que coinciden con todas MENOS UNA (marcadas con `partial`). Escribir el
 * nombre más completo de lo que tiene la ficha ("Miriam Sabogal Mojica"
 * buscando a "Miriam Sabogal") no puede terminar en "Nadie coincide": esa
 * pantalla es la que invita a crear una ficha duplicada.
 */
export function searchMembers(
  fuse: Fuse<SearchableMember>,
  all: SearchableMember[],
  query: string,
  limit = 30,
): SearchableMember[] & { partial?: boolean } {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const hits = new Map<string, number>(); // id → cuántos términos coinciden
  const scoreById = new Map<string, number>();
  let candidateIds: Set<string> | null = null;

  for (const token of tokens) {
    let ids: Set<string>;
    if (token.length < 2) {
      // Token de 1 letra: no se hace difuso, pero SÍ participa en el "AND"
      // como filtro por subcadena (p. ej. "jo r" = contiene "jo" Y "r").
      ids = new Set(
        all
          .filter(
            (m) => m._search.includes(token) || m._aliasSearch.includes(token),
          )
          .map((m) => m.id),
      );
    } else {
      ids = new Set<string>();
      for (const r of fuse.search(token)) {
        ids.add(r.item.id);
        const s = r.score ?? 1;
        scoreById.set(r.item.id, (scoreById.get(r.item.id) ?? 0) + s);
      }
    }
    for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
    candidateIds = candidateIds ? intersect(candidateIds, ids) : ids;
  }

  const byId = new Map(all.map((m) => [m.id, m]));
  const ordenar = (ids: Iterable<string>) =>
    [...ids]
      .map((id) => byId.get(id))
      .filter((m): m is SearchableMember => Boolean(m))
      .sort(
        (a, b) =>
          (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0) ||
          (scoreById.get(a.id) ?? 1) - (scoreById.get(b.id) ?? 1) ||
          a.fullName.localeCompare(b.fullName, 'es'),
      )
      .slice(0, limit);

  if (candidateIds && candidateIds.size > 0) return ordenar(candidateIds);

  // Nadie coincide con todo: con 2+ palabras, las que fallan en una sola.
  const largas = tokens.filter((t) => t.length >= 2).length;
  if (largas < 2) return [];
  const casi = [...hits].filter(([, n]) => n >= tokens.length - 1).map(([id]) => id);
  const out = ordenar(casi) as SearchableMember[] & { partial?: boolean };
  out.partial = out.length > 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* ¿Ya existe esta persona? (antes de crear una ficha nueva)           */
/* ------------------------------------------------------------------ */

/** Distancia de edición, cortando en cuanto supera `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * ¿Dos palabras de un nombre son "la misma"? Exactas si son cortas; con una
 * letra de diferencia si tienen 4 o más (Jaqueline/Jacqueline,
 * Gonzales/González, Baquero/Vaquero, Rodrigez/Rodríguez).
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return editDistance(a, b, 1) <= 1;
}

export interface SimilarMember<M> {
  member: M;
  /** true = el nombre normalizado es idéntico. */
  exact: boolean;
  /** Cuántas palabras del nombre escrito coinciden con esta ficha. */
  matched: number;
}

/**
 * Fichas que podrían ser la misma persona que `name`, de la más a la menos
 * probable. Mira nombre y alias, incluye a las personas inactivas (si
 * alguien vuelve después de meses, no hay que crearla otra vez) y tolera una
 * letra de diferencia por palabra.
 *
 * Con un nombre de una sola palabra ("Rous") basta con que esa palabra
 * coincida con el primer nombre; con dos o más, tienen que coincidir dos.
 * Excepción: una ficha que solo tiene un nombre ("Rous") sale como parecida a
 * "Rous Martínez", porque no tiene una segunda palabra con la que coincidir.
 */
export function findSimilarMembers<
  M extends Pick<Member, 'id' | 'fullName'> & { searchName?: string; aliases?: string[] },
>(members: M[], name: string, limit = 6): SimilarMember<M>[] {
  const buscado = normalizeText(name);
  const palabras = buscado.split(' ').filter((w) => w.length >= 2);
  if (palabras.length === 0) return [];
  const necesarias = Math.min(2, palabras.length);

  const out: SimilarMember<M>[] = [];
  for (const m of members) {
    const propio = m.searchName || normalizeText(m.fullName);
    const nombres = [propio, ...(m.aliases ?? []).map(normalizeText)];
    let mejor = 0;
    let exacto = false;
    let fichaCorta = false;
    for (const n of nombres) {
      if (n === buscado) exacto = true;
      const suyas = n.split(' ').filter(Boolean);
      // Con una sola palabra escrita, debe ser su primer nombre (no
      // cualquier apellido): "Rous" no es "Ana Rous Pérez".
      const matched =
        palabras.length === 1
          ? suyas.length > 0 && sameWord(palabras[0], suyas[0]) ? 1 : 0
          : palabras.filter((w) => suyas.some((s) => sameWord(w, s))).length;
      if (matched > mejor) mejor = matched;
      if (suyas.length === 1 && palabras.length > 1 && sameWord(palabras[0], suyas[0])) {
        fichaCorta = true;
      }
    }
    if (exacto || mejor >= necesarias || fichaCorta) {
      out.push({ member: m, exact: exacto, matched: exacto ? palabras.length : mejor });
    }
  }
  return out
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        b.matched - a.matched ||
        a.member.fullName.localeCompare(b.member.fullName, 'es'),
    )
    .slice(0, limit);
}

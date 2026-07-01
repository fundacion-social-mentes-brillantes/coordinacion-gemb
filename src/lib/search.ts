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
 */
export function searchMembers(
  fuse: Fuse<SearchableMember>,
  all: SearchableMember[],
  query: string,
  limit = 30,
): SearchableMember[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  let candidateIds: Set<string> | null = null;
  const scoreById = new Map<string, number>();

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
    candidateIds = candidateIds ? intersect(candidateIds, ids) : ids;
    if (candidateIds.size === 0) break;
  }

  if (!candidateIds || candidateIds.size === 0) return [];

  const byId = new Map(all.map((m) => [m.id, m]));
  return [...candidateIds]
    .map((id) => byId.get(id))
    .filter((m): m is SearchableMember => Boolean(m))
    .sort(
      (a, b) =>
        (scoreById.get(a.id) ?? 1) - (scoreById.get(b.id) ?? 1) ||
        a.fullName.localeCompare(b.fullName, 'es'),
    )
    .slice(0, limit);
}

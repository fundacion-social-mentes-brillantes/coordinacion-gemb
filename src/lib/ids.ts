// Ids repetibles: la misma operación hecha dos veces (dos celulares, un
// reintento sin señal, o Claude confirmando dos veces) cae en el MISMO
// documento en vez de crear otro. Lo usan la app y el servidor de Claude, así
// que los dos llegan al mismo id para la misma persona en la misma reunión.

/** Hash corto y estable (FNV-1a de 2×32 bits) para armar ids repetibles. */
export function hashCorto(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x0100019d) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}

/** Ficha de alguien agregado en plena reunión (`searchName` ya normalizado). */
export const walkinId = (sessionId: string, searchName: string) =>
  `p_${hashCorto(`${sessionId}|${searchName}`)}`;

/** La primera reunión de un tipo en un día ("reduccion_ego-2026-10-06"). */
export const sessionIdDelDia = (type: string, dia: string) => `${type}-${dia}`;

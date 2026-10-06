import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
//  Sobres cerrados: lo que el servidor le entrega a Claude va cifrado.
//
//  Antes, el código que viajaba en la dirección de vuelta (?code=…) y el
//  permiso que guarda Claude eran la llave de sesión de Firebase tal cual, en
//  base64. Esa dirección queda en el historial del navegador: cualquiera que
//  la viera sacaba la llave y entraba como esa persona, sin pasar por aquí.
//
//  Ahora van cifrados (AES-256-GCM) con una clave que solo existe en Vercel
//  (variable MCP_SECRETO). Fuera de este servidor no sirven para nada, y
//  cambiando esa variable se desconecta a todo el mundo de una vez.
//
//  El "tipo" va autenticado junto al contenido: un código no sirve como
//  permiso ni al revés.
// ---------------------------------------------------------------------------

const PREFIJO = 'g1.';

export type TipoSobre = 'codigo' | 'acceso';

export class SinSecretoError extends Error {}

function clave(): Buffer {
  const s = process.env.MCP_SECRETO ?? '';
  if (s.length < 32) {
    throw new SinSecretoError(
      'Falta configurar MCP_SECRETO en el servidor (Vercel → Settings → ' +
        'Environment Variables). Sin ella no se puede conectar Claude.',
    );
  }
  return createHash('sha256').update(s).digest();
}

/** ¿Parece un sobre de este servidor? (No dice si es válido.) */
export const esSobre = (s: string) => s.startsWith(PREFIJO);

export function sellar(tipo: TipoSobre, datos: object): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  c.setAAD(Buffer.from(tipo));
  const cuerpo = Buffer.concat([c.update(JSON.stringify(datos), 'utf8'), c.final()]);
  return PREFIJO + Buffer.concat([iv, cuerpo, c.getAuthTag()]).toString('base64url');
}

/** El contenido, o null si el sobre no es de aquí, está alterado o es de otro tipo. */
export function abrir<T>(tipo: TipoSobre, sobre: string): T | null {
  if (!esSobre(sobre)) return null;
  const k = clave();
  try {
    const b = Buffer.from(sobre.slice(PREFIJO.length), 'base64url');
    if (b.length < 12 + 16 + 2) return null;
    const d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAAD(Buffer.from(tipo));
    d.setAuthTag(b.subarray(b.length - 16));
    const json = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
    return JSON.parse(json.toString('utf8')) as T;
  } catch {
    return null;
  }
}

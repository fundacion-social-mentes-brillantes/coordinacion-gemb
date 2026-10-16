// ---------------------------------------------------------------------------
//  A dónde se puede devolver a la persona después de "Permitir".
//
//  Esto NO es un detalle de configuración: es la cerradura.
//
//  Al aceptar, la pantalla /autorizar entrega un código que lleva dentro la
//  llave de sesión de quien acepta. Si se admitiera cualquier `redirect_uri`,
//  bastaría con mandarle a alguien un enlace a nuestra propia app —dominio
//  correcto, candado y todo— para que, al tocar "Permitir", su llave viajara
//  al sitio del atacante. Con esa llave se entra como esa persona.
//
//  Por eso la dirección de retorno se compara contra una lista cerrada. Lo que
//  no esté aquí, no recibe nada.
//
//  Este archivo lo usan LAS DOS PUERTAS —la app (AuthorizePage) y el servidor
//  (mcp/src/oauth.ts)— a propósito: si algún día hay que añadir un cliente, se
//  añade en un solo sitio y las dos quedan de acuerdo.
// ---------------------------------------------------------------------------

/** Dominios de Claude. Se admite el dominio y cualquier subdominio suyo. */
const DOMINIOS = ['claude.ai', 'claude.com', 'anthropic.com'];

/**
 * ChatGPT (OpenAI), desde el 16 oct 2026. Más estricto que con Claude a
 * propósito: SOLO chatgpt.com (sin subdominios ni puerto) y SOLO las dos
 * direcciones de vuelta de sus conectores, porque en chatgpt.com cualquiera
 * puede publicar páginas (conversaciones compartidas, GPTs) y ninguna de ellas
 * debe poder recibir un código. Según developers.openai.com/apps-sdk/build/auth:
 *   https://chatgpt.com/connector_platform_oauth_redirect   (la fija)
 *   https://chatgpt.com/connector/oauth/{id}                 (una por conexión)
 */
const CHATGPT = 'chatgpt.com';
const RUTAS_CHATGPT = [/^\/connector_platform_oauth_redirect$/, /^\/connector\/oauth\/[A-Za-z0-9_-]+$/];

/** Equipos locales: Claude de escritorio y Claude Code abren un puerto propio. */
const LOCALES = ['localhost', '127.0.0.1', '::1'];

/**
 * ¿Se le puede devolver el código a esta dirección?
 *
 * Exige https salvo en el propio equipo, donde el navegador ya obliga a que
 * sea local y no hay red de por medio.
 */
export function redirectPermitido(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }

  // El nombre del equipo, sin puerto y sin los corchetes de IPv6.
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (LOCALES.includes(host)) {
    return u.protocol === 'http:' || u.protocol === 'https:';
  }

  if (u.protocol !== 'https:') return false;

  if (host === CHATGPT) {
    return u.port === '' && RUTAS_CHATGPT.some((r) => r.test(u.pathname));
  }

  // `endsWith('.' + d)` y no `includes(d)`: si no, "claude.ai.malo.com" pasaría.
  return DOMINIOS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Para decirle a la persona a quién le está dando permiso. */
export function asistenteDe(uri: string): 'ChatGPT' | 'Claude' {
  try {
    return new URL(uri).hostname.toLowerCase() === CHATGPT ? 'ChatGPT' : 'Claude';
  } catch {
    return 'Claude';
  }
}

/** Para el mensaje de error, sin repetir la lista a mano en cada pantalla. */
export const DESTINOS_PERMITIDOS = [...DOMINIOS, CHATGPT, ...LOCALES].join(', ');

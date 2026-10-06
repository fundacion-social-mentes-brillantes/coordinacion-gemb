// ---------------------------------------------------------------------------
//  Entrar con Google, sin llaves que copiar.
//
//  Esto es lo que hace que el conector se instale como cualquier otro: se
//  toca "Conectar", se abre el navegador, se entra con Google —la misma cuenta
//  de siempre— y listo. Nadie ve ni pega ninguna llave.
//
//  Cómo encaja:
//
//    Claude  →  /api/oauth/authorize   (empieza; exige PKCE)
//            →  la app: /autorizar     (la persona entra con Google)
//            →  /api/oauth/aprobar     (la app entrega la llave por POST y
//                                       recibe un código CIFRADO, ver sobre.ts)
//            →  vuelve a Claude con ese código
//            →  /api/oauth/token       (el código se cambia por el permiso,
//                                       también cifrado)
//            →  ya puede consultar
//
//  La llave de sesión de Firebase nunca aparece en una dirección: antes iba
//  dentro del código, en claro, y quedaba en el historial del navegador.
//
//  El permiso que sale de aquí es el de esa persona, así que su rol —y por
//  tanto qué puede hacer— viene dado. No hay nada que configurar por usuario.
// ---------------------------------------------------------------------------

import { redirectPermitido } from '../../src/lib/oauthRedirect';
import { abrir, sellar, SinSecretoError } from './sobre';

const RAIZ = 'https://coordinacion-gemb.vercel.app';
const RECURSO = `${RAIZ}/api/mcp`;

export interface Peticion {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface Respuesta {
  status: (n: number) => Respuesta;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: string) => void;
}

function parametros(req: Peticion): URLSearchParams {
  try {
    return new URL(req.url ?? '', RAIZ).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * El cuerpo, con cada valor convertido a texto.
 *
 * Sirve para /token, donde todo son cadenas sueltas (grant_type, code…) y da
 * igual cómo llegaran. NO sirve para /register, que recibe listas: ver
 * `cuerpoCrudo`.
 */
function cuerpo(req: Peticion): Record<string, string> {
  const b = crudo(req);
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) {
    salida[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return salida;
}

/**
 * El cuerpo TAL CUAL, conservando listas y números.
 *
 * Aquí estuvo el fallo que dejaba el conector sin herramientas: el registro
 * recibe `redirect_uris` como lista, pero se le pasaba por el aplanador de
 * arriba, que la convertía en la cadena '["https://…"]'. `Array.isArray` daba
 * falso, se devolvía una lista vacía, y el cliente concluía —con razón— que su
 * dirección de retorno no había quedado registrada y abortaba con un
 * "No se pudo registrar" que no decía por qué.
 */
function crudo(req: Peticion): Record<string, unknown> {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    const t = b.trim();
    if (!t) return {};
    // Puede venir como JSON en texto (según cómo lo entregue la plataforma) o
    // como formulario. Se intenta lo primero y se cae a lo segundo.
    if (t.startsWith('{')) {
      try {
        const j: unknown = JSON.parse(t);
        if (j && typeof j === 'object') return j as Record<string, unknown>;
      } catch {
        /* no era JSON: se trata como formulario */
      }
    }
    return Object.fromEntries(new URLSearchParams(t));
  }
  if (typeof b === 'object') return b as Record<string, unknown>;
  return {};
}

/* ------------------------------------------------------------------ */
/* Descubrimiento                                                      */
/* ------------------------------------------------------------------ */

export function metadatosServidor() {
  return {
    issuer: RAIZ,
    authorization_endpoint: `${RAIZ}/api/oauth/authorize`,
    token_endpoint: `${RAIZ}/api/oauth/token`,
    registration_endpoint: `${RAIZ}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['coordinacion'],
  };
}

export function metadatosRecurso() {
  return {
    resource: RECURSO,
    authorization_servers: [RAIZ],
    scopes_supported: ['coordinacion'],
    bearer_methods_supported: ['header'],
  };
}

/* ------------------------------------------------------------------ */
/* Registro del cliente                                                */
/* ------------------------------------------------------------------ */

/**
 * Una lista de direcciones, venga como lista de verdad, como una sola cadena,
 * o como una lista dentro de una cadena. Se es tolerante a propósito: lo que
 * de verdad decide quién recibe el código es `redirectPermitido`, no esto.
 */
function listaDeTextos(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v !== 'string') return [];
  const t = v.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const j: unknown = JSON.parse(t);
      if (Array.isArray(j)) return j.filter((x): x is string => typeof x === 'string');
    } catch {
      /* no era una lista en JSON: se toma como una sola dirección */
    }
  }
  return [t];
}

/**
 * Cualquier cliente puede registrarse. No es un descuido: el registro no
 * concede nada. Lo único que abre datos es que una persona real entre con su
 * Google y acepte, y lo que vea entonces lo deciden sus permisos en la app.
 */
export function registrarCliente(datos: Record<string, unknown>) {
  const redirects = listaDeTextos(datos.redirect_uris);
  return {
    client_id: `gemb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirects,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: typeof datos.client_name === 'string' ? datos.client_name : 'Cliente MCP',
  };
}

/* ------------------------------------------------------------------ */
/* El código y el permiso                                              */
/* ------------------------------------------------------------------ */

interface Codigo {
  llave: string;
  reto: string;
  /** A dónde se entregó: el canje tiene que decir la misma dirección. */
  destino: string;
  exp: number;
}

/** Lo que guarda Claude como permiso (cifrado). */
export interface Acceso {
  llave: string;
  /** Cuándo se conectó (ms). */
  desde: number;
}

/** Un reto PKCE S256 son 43 caracteres base64url. */
const RETO_VALIDO = /^[A-Za-z0-9_-]{43}$/;

async function sha256Base64Url(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return Buffer.from(hash).toString('base64url');
}

/* ------------------------------------------------------------------ */
/* Los tres pasos                                                      */
/* ------------------------------------------------------------------ */

/**
 * Paso 1: mandar a la persona a entrar con Google.
 *
 * No se pide nada aquí: se reenvía a una pantalla de la propia app, que ya
 * sabe hacer el ingreso con Google, y que al terminar devuelve a Claude.
 */
export function irAAutorizar(req: Peticion): { destino: string } | { error: string } {
  const p = parametros(req);
  const redirect = p.get('redirect_uri');
  if (!redirect) return { error: 'Falta redirect_uri.' };
  // Primera puerta. La segunda está en /api/oauth/aprobar, que vuelve a
  // comprobarlo antes de entregar nada.
  if (!redirectPermitido(redirect)) {
    return { error: 'Esa dirección de retorno no está autorizada.' };
  }
  // PKCE obligatorio (S256): sin él, quien viera el código podría canjearlo.
  const metodo = p.get('code_challenge_method') ?? 'plain';
  if (metodo !== 'S256' || !RETO_VALIDO.test(p.get('code_challenge') ?? '')) {
    return { error: 'Hace falta PKCE con code_challenge_method=S256.' };
  }

  const destino = new URL(`${RAIZ}/autorizar`);
  destino.searchParams.set('redirect_uri', redirect);
  if (p.get('state')) destino.searchParams.set('state', p.get('state')!);
  if (p.get('code_challenge')) {
    destino.searchParams.set('code_challenge', p.get('code_challenge')!);
  }
  return { destino: destino.toString() };
}

/**
 * Paso 2: la persona tocó "Permitir" en /autorizar. La app manda aquí (por
 * POST, nunca en la dirección) su llave de sesión, y recibe la dirección de
 * vuelta a Claude con un código cifrado que solo este servidor sabe abrir.
 */
export function aprobar(datos: Record<string, unknown>): { destino: string } | { error: string } {
  const llave = typeof datos.llave === 'string' ? datos.llave.trim() : '';
  const redirect = typeof datos.redirect_uri === 'string' ? datos.redirect_uri : '';
  const reto = typeof datos.code_challenge === 'string' ? datos.code_challenge : '';
  const state = typeof datos.state === 'string' ? datos.state : '';

  if (llave.length < 20) return { error: 'Falta la sesión. Vuelve a entrar con Google.' };
  if (!redirect || !redirectPermitido(redirect)) {
    return { error: 'Esa dirección de retorno no está autorizada.' };
  }
  if (!RETO_VALIDO.test(reto)) {
    return { error: 'Falta información de seguridad (PKCE). Vuelve a intentarlo desde Claude.' };
  }

  const codigo: Codigo = { llave, reto, destino: redirect, exp: Date.now() + 5 * 60_000 };
  const destino = new URL(redirect);
  destino.searchParams.set('code', sellar('codigo', codigo));
  if (state) destino.searchParams.set('state', state);
  return { destino: destino.toString() };
}

/** Paso 3: cambiar el código por el permiso de consulta. */
export async function canjearCodigo(
  req: Peticion,
): Promise<{ ok: object } | { error: string; detalle: string }> {
  const datos = { ...Object.fromEntries(parametros(req)), ...cuerpo(req) };

  if (datos.grant_type !== 'authorization_code') {
    return { error: 'unsupported_grant_type', detalle: 'Solo se admite authorization_code.' };
  }
  if (!datos.code) {
    return { error: 'invalid_request', detalle: 'Falta el código.' };
  }

  const codigo = abrir<Codigo>('codigo', datos.code);
  if (!codigo) {
    return { error: 'invalid_grant', detalle: 'El código no es válido.' };
  }
  if (typeof codigo.exp !== 'number' || Date.now() > codigo.exp) {
    return { error: 'invalid_grant', detalle: 'El código caducó. Vuelve a conectar.' };
  }
  if (datos.redirect_uri && datos.redirect_uri !== codigo.destino) {
    return { error: 'invalid_grant', detalle: 'La dirección de retorno no coincide.' };
  }

  // PKCE: quien canjea tiene que demostrar que es quien empezó.
  const verificador = datos.code_verifier;
  if (!verificador) {
    return { error: 'invalid_request', detalle: 'Falta code_verifier.' };
  }
  if ((await sha256Base64Url(verificador)) !== codigo.reto) {
    return { error: 'invalid_grant', detalle: 'El code_verifier no coincide.' };
  }

  const acceso: Acceso = { llave: codigo.llave, desde: Date.now() };
  return {
    ok: {
      access_token: sellar('acceso', acceso),
      token_type: 'Bearer',
      // Por dentro, la sesión se renueva sola en cada consulta. Se anuncia
      // una hora, como siempre, para que el cliente no la cachee de más.
      expires_in: 3600,
      scope: 'coordinacion',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Enrutado                                                            */
/* ------------------------------------------------------------------ */

export async function atenderOauth(req: Peticion, res: Respuesta, ruta: string) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    await rutear(req, res, ruta);
  } catch (e) {
    if (e instanceof SinSecretoError) {
      res.status(500).json({ error: 'server_error', error_description: e.message });
      return;
    }
    throw e;
  }
}

async function rutear(req: Peticion, res: Respuesta, ruta: string) {
  switch (ruta) {
    case 'as-metadata':
      res.status(200).json(metadatosServidor());
      return;

    case 'pr-metadata':
      res.status(200).json(metadatosRecurso());
      return;

    case 'register':
      // `crudo` y no `cuerpo`: aquí llegan listas y hay que conservarlas.
      res.status(201).json(registrarCliente(crudo(req)));
      return;

    case 'authorize': {
      const r = irAAutorizar(req);
      if ('error' in r) {
        res.status(400).json({ error: 'invalid_request', error_description: r.error });
        return;
      }
      res.setHeader('Location', r.destino);
      res.status(302).end();
      return;
    }

    case 'aprobar': {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'invalid_request', error_description: 'Usa POST.' });
        return;
      }
      const r = aprobar(crudo(req));
      if ('error' in r) {
        res.status(400).json({ error: 'invalid_request', error_description: r.error });
        return;
      }
      res.status(200).json(r);
      return;
    }

    case 'token': {
      const r = await canjearCodigo(req);
      if ('error' in r) {
        res.status(400).json({ error: r.error, error_description: r.detalle });
        return;
      }
      res.status(200).json(r.ok);
      return;
    }

    default:
      res.status(404).json({ error: 'not_found' });
  }
}

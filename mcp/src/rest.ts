import type { Attendance, Member, Session } from '../../src/types';

// ---------------------------------------------------------------------------
//  Lectura de Firestore entrando como un USUARIO de la app.
//
//  Por qué así y no con el SDK de administrador:
//
//  1. Muchas organizaciones (la de la fundación entre ellas) tienen prohibido
//     crear claves de cuenta de servicio, así que ese camino sencillamente no
//     está disponible.
//  2. Es MÁS seguro: una llave de administrador se salta todas las reglas de
//     Firestore; esta cuenta pasa por ellas, igual que cualquier coordinadora.
//     Si mañana se restringe algo en firestore.rules, también aplica aquí.
//  3. Se revoca en un toque desde la propia app (Usuarios → desactivar), sin
//     entrar a la consola de Google.
//
//  Solo usa fetch: ninguna dependencia, así que corre igual en un servidor
//  pequeño, en una función de Vercel o en tu computador.
// ---------------------------------------------------------------------------

const PROJECT_ID = 'coordinacion-gemb';
/** Llave pública de la app web: viaja en el bundle del navegador, no es secreta. */
const API_KEY = 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ';

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export class ConfigError extends Error {}
export class AccesoError extends Error {}

/* ------------------------------------------------------------------ */
/* Sesión                                                              */
/* ------------------------------------------------------------------ */

interface Sesion {
  idToken: string;
  uid: string;
  email: string;
  expira: number;
}
let sesion: Sesion | null = null;

async function entrar(): Promise<Sesion> {
  if (sesion && sesion.expira > Date.now() + 60_000) return sesion;

  const email = process.env.GEMB_EMAIL?.trim();
  const password = process.env.GEMB_PASSWORD;
  if (!email || !password) {
    throw new ConfigError(
      'Faltan GEMB_EMAIL y GEMB_PASSWORD: son los datos de la cuenta de solo ' +
        'lectura que la app usa para consultar. Ver mcp/README.md.',
    );
  }

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = (await r.json()) as {
    idToken?: string;
    localId?: string;
    expiresIn?: string;
    error?: { message?: string };
  };

  if (!r.ok || !data.idToken) {
    const codigo = data.error?.message ?? `HTTP ${r.status}`;
    throw new ConfigError(mensajeDeEntrada(codigo, email));
  }

  sesion = {
    idToken: data.idToken,
    uid: data.localId ?? '',
    email,
    expira: Date.now() + Number(data.expiresIn ?? 3600) * 1000,
  };
  return sesion;
}

/** Traduce los códigos de Firebase a algo que se pueda arreglar. */
function mensajeDeEntrada(codigo: string, email: string): string {
  if (codigo.startsWith('PASSWORD_LOGIN_DISABLED')) {
    return (
      'Falta activar el ingreso por correo y contraseña en Firebase: ' +
      'consola de Firebase → Authentication → Sign-in method → ' +
      'Email/Password → Habilitar. (Es un interruptor; no tiene nada que ver ' +
      'con las claves de cuenta de servicio que tu organización bloquea.)'
    );
  }
  if (
    codigo.startsWith('EMAIL_NOT_FOUND') ||
    codigo.startsWith('INVALID_LOGIN_CREDENTIALS') ||
    codigo.startsWith('INVALID_PASSWORD')
  ) {
    return (
      `No se pudo entrar como ${email}. Comprueba que la cuenta existe ` +
      '(Firebase → Authentication → Users → Add user) y que la contraseña ' +
      'guardada coincide.'
    );
  }
  if (codigo.startsWith('USER_DISABLED')) {
    return `La cuenta ${email} está deshabilitada en Firebase.`;
  }
  if (codigo.startsWith('TOO_MANY_ATTEMPTS')) {
    return 'Firebase bloqueó temporalmente los intentos. Espera unos minutos.';
  }
  return `No se pudo entrar como ${email}: ${codigo}`;
}

/* ------------------------------------------------------------------ */
/* Registro de la cuenta dentro de la app                              */
/* ------------------------------------------------------------------ */

/**
 * Las reglas exigen que exista `users/{uid}` con un rol para poder leer.
 * Esta cuenta nunca entra por la pantalla de la app, así que ese documento
 * no se crea solo: se crea aquí, UNA vez, y solo funciona si una
 * administradora la pre-autorizó antes (Usuarios → "Pre-autorizar por
 * correo"). Es la ÚNICA escritura de todo el servidor.
 */
async function registrarse(s: Sesion): Promise<void> {
  const invite = await pedir(`${DOCS}/invites/${encodeURIComponent(s.email)}`, s, true);
  const rol =
    invite && typeof invite === 'object'
      ? ((invite as { fields?: { role?: { stringValue?: string } } }).fields?.role
          ?.stringValue ?? '')
      : '';

  if (!rol) {
    throw new AccesoError(
      `La cuenta ${s.email} todavía no tiene permiso dentro de la app. ` +
        'Entra a la app como administradora → Usuarios → "Pre-autorizar por ' +
        `correo" → ${s.email} con rol Coordinador(a). Después vuelve a intentar.`,
    );
  }

  const r = await fetch(`${DOCS}/users/${s.uid}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${s.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        email: { stringValue: s.email },
        displayName: { stringValue: 'Consultas (Claude)' },
        photoURL: { stringValue: '' },
        role: { stringValue: rol },
        active: { booleanValue: true },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (!r.ok) {
    throw new AccesoError(
      `No se pudo registrar la cuenta ${s.email} dentro de la app ` +
        `(HTTP ${r.status}). Comprueba que la pre-autorización existe y que el ` +
        'rol es "admin" o "coordinador".',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

async function pedir(
  url: string,
  s: Sesion,
  toleraFalta = false,
): Promise<unknown> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${s.idToken}` } });
  if (r.status === 404 && toleraFalta) return null;
  if (r.status === 403) {
    throw new AccesoError('PERMISSION_DENIED');
  }
  if (!r.ok) {
    throw new AccesoError(`Firestore respondió HTTP ${r.status} en ${url}`);
  }
  return r.json();
}

interface DocRest {
  name: string;
  fields?: Record<string, unknown>;
}

/** Convierte el formato de Firestore REST a valores normales de JavaScript. */
function valor(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('stringValue' in o) return o.stringValue;
  if ('booleanValue' in o) return o.booleanValue;
  if ('integerValue' in o) return Number(o.integerValue);
  if ('doubleValue' in o) return o.doubleValue;
  // Se devuelve Date: toDate() de la app lo entiende tal cual.
  if ('timestampValue' in o) return new Date(o.timestampValue as string);
  if ('nullValue' in o) return null;
  if ('arrayValue' in o) {
    const a = (o.arrayValue as { values?: unknown[] }).values ?? [];
    return a.map(valor);
  }
  if ('mapValue' in o) {
    return campos((o.mapValue as { fields?: Record<string, unknown> }).fields);
  }
  if ('referenceValue' in o) return o.referenceValue;
  return undefined;
}

function campos(f?: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f ?? {})) salida[k] = valor(v);
  return salida;
}

function aObjeto<T>(d: DocRest): T {
  const id = d.name.split('/').pop() ?? '';
  // El id va al final para que no lo pise un campo guardado con ese nombre.
  return { ...campos(d.fields), id } as T;
}

/** Lee una colección completa, siguiendo la paginación. */
async function coleccion<T>(nombre: string, s: Sesion): Promise<T[]> {
  const salida: T[] = [];
  let token = '';
  do {
    const url = `${DOCS}/${nombre}?pageSize=300${token ? `&pageToken=${token}` : ''}`;
    const r = (await pedir(url, s)) as { documents?: DocRest[]; nextPageToken?: string };
    for (const d of r.documents ?? []) salida.push(aObjeto<T>(d));
    token = r.nextPageToken ?? '';
  } while (token);
  return salida;
}

/**
 * Lee TODA la asistencia (consulta de grupo de colección), por tandas y
 * ordenada por el nombre del documento para poder continuar donde iba.
 */
async function todaLaAsistencia(s: Sesion): Promise<Attendance[]> {
  const salida: Attendance[] = [];
  const TANDA = 1000;
  let ultimo: string | null = null;

  for (;;) {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: 'attendance', allDescendants: true }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: TANDA,
    };
    if (ultimo) {
      structuredQuery.startAt = {
        values: [{ referenceValue: ultimo }],
        before: false,
      };
    }

    const r = await fetch(`${DOCS}:runQuery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${s.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ structuredQuery }),
    });
    if (r.status === 403) throw new AccesoError('PERMISSION_DENIED');
    if (!r.ok) throw new AccesoError(`Firestore respondió HTTP ${r.status} al leer la asistencia`);

    const filas = (await r.json()) as { document?: DocRest }[];
    const docs = filas.map((f) => f.document).filter((d): d is DocRest => !!d);
    for (const d of docs) salida.push(aObjeto<Attendance>(d));

    if (docs.length < TANDA) break;
    ultimo = docs[docs.length - 1].name;
  }
  return salida;
}

/* ------------------------------------------------------------------ */
/* Caché corta                                                         */
/* ------------------------------------------------------------------ */

const TTL_MS = 60_000;
const cache = new Map<string, { valor: unknown; hasta: number }>();

async function cacheado<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
  const hit = cache.get(clave);
  if (hit && hit.hasta > Date.now()) return hit.valor as T;
  const valor = await cargar();
  cache.set(clave, { valor, hasta: Date.now() + TTL_MS });
  return valor;
}

export function limpiarCache() {
  cache.clear();
  sesion = null;
}

/* ------------------------------------------------------------------ */
/* Lo que usa el resto del servidor                                    */
/* ------------------------------------------------------------------ */

export type MemberPublico = Omit<Member, 'phone' | 'notes'>;

/** Entra y, si hace falta, registra la cuenta dentro de la app. */
async function listo(): Promise<Sesion> {
  const s = await entrar();
  const yo = await pedir(`${DOCS}/users/${s.uid}`, s, true).catch((e) => {
    if (e instanceof AccesoError && e.message === 'PERMISSION_DENIED') return null;
    throw e;
  });
  if (!yo) await registrarse(s);
  return s;
}

export async function cargarSesiones(): Promise<Session[]> {
  return cacheado('sessions', async () => coleccion<Session>('sessions', await listo()));
}

export async function cargarAsistencia(): Promise<Attendance[]> {
  return cacheado('attendance', async () => todaLaAsistencia(await listo()));
}

export async function cargarPersonas(): Promise<MemberPublico[]> {
  return cacheado('members', async () => {
    const todas = await coleccion<Member>('members', await listo());
    // Ni teléfonos ni notas privadas salen de aquí.
    return todas.map(({ phone: _p, notes: _n, ...resto }) => resto as MemberPublico);
  });
}

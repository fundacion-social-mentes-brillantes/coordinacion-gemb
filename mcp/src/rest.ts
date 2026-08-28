import type { Attendance, Member, Role, Session } from '../../src/types';

// ---------------------------------------------------------------------------
//  Lectura de Firestore ENTRANDO COMO CADA PERSONA.
//
//  Cada quien conecta su propio Claude con su propia llave, sacada de la app
//  donde ya inició sesión con Google. De ahí salen tres cosas gratis:
//
//  1. Las reglas de Firestore se aplican solas. Una coordinadora ve lo que
//     ve una coordinadora; una administradora, lo suyo. No hay que replicar
//     los permisos aquí ni mantenerlos sincronizados.
//  2. El servidor no guarda NINGÚN secreto. La llave viaja en cada petición y
//     no se escribe en ningún lado. Si el servidor se ve comprometido, no hay
//     nada que robar.
//  3. Se corta el acceso desde la app (Usuarios → desactivar) y deja de
//     funcionar al instante, porque las reglas exigen `active == true`.
//
//  Sin dependencias: solo fetch.
// ---------------------------------------------------------------------------

const PROJECT_ID = 'coordinacion-gemb';
/** Llave pública de la app web: viaja en el bundle del navegador, no es secreta. */
const API_KEY = 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ';

const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export class ConfigError extends Error {}
export class AccesoError extends Error {}

export type MemberPublico = Omit<Member, 'phone' | 'notes'>;

export interface Cliente {
  uid: string;
  email: string;
  nombre: string;
  rol: Role;
  /** true = puede escribir. Las coordinadoras solo leen. */
  esAdmin: boolean;
  cargarSesiones(): Promise<Session[]>;
  cargarAsistencia(): Promise<Attendance[]>;
  cargarPersonas(): Promise<MemberPublico[]>;
  /** Crea o reemplaza un documento. Solo para administración. */
  escribir(ruta: string, campos: Record<string, unknown>, mascara?: string[]): Promise<void>;
  /** Borra un documento. Solo para administración. */
  borrar(ruta: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

interface Credencial {
  idToken: string;
  uid: string;
  expira: number;
}

/**
 * Canjea la llave de la persona por un permiso de corta duración.
 *
 * La llave es el "refresh token" que Firebase le dio a su navegador al
 * iniciar sesión en la app. Nunca se guarda aquí: llega en la petición, se
 * usa y se descarta.
 */
async function canjear(llave: string): Promise<Credencial> {
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(llave)}`,
  });
  const d = (await r.json()) as {
    id_token?: string;
    user_id?: string;
    expires_in?: string;
    error?: { message?: string };
  };

  if (!r.ok || !d.id_token) {
    const codigo = d.error?.message ?? `HTTP ${r.status}`;
    if (
      codigo.startsWith('TOKEN_EXPIRED') ||
      codigo.startsWith('USER_NOT_FOUND') ||
      codigo.startsWith('INVALID_REFRESH_TOKEN') ||
      codigo.startsWith('INVALID_GRANT_TYPE')
    ) {
      throw new AccesoError(
        'La llave ya no sirve (caducó, o cerraste la sesión en la app). ' +
          'Entra a la app → Panel → "Conectar con Claude" y copia una nueva.',
      );
    }
    if (codigo.startsWith('USER_DISABLED')) {
      throw new AccesoError('Esta cuenta está deshabilitada.');
    }
    throw new AccesoError(`No se pudo validar la llave: ${codigo}`);
  }

  return {
    idToken: d.id_token,
    uid: d.user_id ?? '',
    expira: Date.now() + Number(d.expires_in ?? 3600) * 1000,
  };
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

interface DocRest {
  name: string;
  fields?: Record<string, unknown>;
}

async function pedir(url: string, idToken: string, toleraFalta = false): Promise<unknown> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (r.status === 404 && toleraFalta) return null;
  if (r.status === 403) throw new AccesoError('PERMISSION_DENIED');
  if (!r.ok) throw new AccesoError(`Firestore respondió HTTP ${r.status}`);
  return r.json();
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
    return ((o.arrayValue as { values?: unknown[] }).values ?? []).map(valor);
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

async function coleccion<T>(nombre: string, idToken: string): Promise<T[]> {
  const salida: T[] = [];
  let token = '';
  do {
    const url = `${DOCS}/${nombre}?pageSize=300${token ? `&pageToken=${token}` : ''}`;
    const r = (await pedir(url, idToken)) as { documents?: DocRest[]; nextPageToken?: string };
    for (const d of r.documents ?? []) salida.push(aObjeto<T>(d));
    token = r.nextPageToken ?? '';
  } while (token);
  return salida;
}

/** Toda la asistencia, por tandas, ordenada para poder continuar donde iba. */
async function todaLaAsistencia(idToken: string): Promise<Attendance[]> {
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
      structuredQuery.startAt = { values: [{ referenceValue: ultimo }], before: false };
    }

    const r = await fetch(`${DOCS}:runQuery`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
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
/* Caché por persona                                                   */
/* ------------------------------------------------------------------ */

const TTL_MS = 60_000;
const cache = new Map<string, { valor: unknown; hasta: number }>();

function limpiarVencidos() {
  const ahora = Date.now();
  for (const [k, v] of cache) if (v.hasta <= ahora) cache.delete(k);
}

/* ------------------------------------------------------------------ */
/* Abrir sesión                                                        */
/* ------------------------------------------------------------------ */

/**
 * Valida la llave de la persona y devuelve un cliente que lee EN SU NOMBRE.
 * El rol sale de su ficha en la app, la misma que usa la pantalla.
 */
export async function abrirSesion(llave: string): Promise<Cliente> {
  if (!llave || llave.length < 20) {
    throw new ConfigError(
      'Falta la llave personal. Entra a la app → Panel → "Conectar con Claude" ' +
        'y copia la tuya.',
    );
  }
  limpiarVencidos();
  const cred = await canjear(llave);

  const yo = (await pedir(`${DOCS}/users/${cred.uid}`, cred.idToken, true)) as DocRest | null;
  if (!yo) {
    throw new AccesoError(
      'Tu cuenta todavía no está dada de alta en la app. Entra una vez a la ' +
        'app con Google y pide que te aprueben.',
    );
  }
  const perfil = campos(yo.fields) as {
    email?: string;
    displayName?: string;
    role?: Role;
    active?: boolean;
  };

  if (perfil.active === false) {
    throw new AccesoError('Tu acceso está desactivado en la app. Habla con la administración.');
  }
  const rol = (perfil.role ?? 'pending') as Role;
  if (rol === 'pending') {
    throw new AccesoError('Tu acceso está pendiente de aprobación en la app.');
  }

  const esAdmin = rol === 'admin' || rol === 'super_admin';
  const clave = (sufijo: string) => `${cred.uid}:${sufijo}`;

  async function cacheado<T>(sufijo: string, cargar: () => Promise<T>): Promise<T> {
    const k = clave(sufijo);
    const hit = cache.get(k);
    if (hit && hit.hasta > Date.now()) return hit.valor as T;
    const v = await cargar();
    cache.set(k, { valor: v, hasta: Date.now() + TTL_MS });
    return v;
  }

  return {
    uid: cred.uid,
    email: perfil.email ?? '',
    nombre: perfil.displayName || perfil.email || 'Sin nombre',
    rol,
    esAdmin,
    cargarSesiones: () => cacheado('sessions', () => coleccion<Session>('sessions', cred.idToken)),
    cargarAsistencia: () => cacheado('attendance', () => todaLaAsistencia(cred.idToken)),
    cargarPersonas: () =>
      cacheado('members', async () => {
        const todas = await coleccion<Member>('members', cred.idToken);
        // Ni teléfonos ni notas privadas salen de aquí, para nadie.
        return todas.map(({ phone: _p, notes: _n, ...resto }) => resto as MemberPublico);
      }),
    async escribir(ruta, datos, mascara) {
      exigirAdmin(esAdmin);
      await escribirDoc(ruta, datos, cred.idToken, mascara);
      olvidar(cred.uid);
    },
    async borrar(ruta) {
      exigirAdmin(esAdmin);
      await borrarDoc(ruta, cred.idToken);
      olvidar(cred.uid);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Escritura (solo administración)                                     */
/* ------------------------------------------------------------------ */

/** Convierte un valor normal de JavaScript al formato de Firestore REST. */
function aValorRest(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValorRest) } };
  if (typeof v === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) fields[k] = aValorRest(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function escribirDoc(
  ruta: string,
  datos: Record<string, unknown>,
  idToken: string,
  mascara?: string[],
): Promise<void> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(datos)) fields[k] = aValorRest(v);

  // Con máscara se tocan SOLO esos campos; sin ella se reemplaza el documento.
  const query = mascara?.length
    ? '?' + mascara.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';

  const r = await fetch(`${DOCS}/${ruta}${query}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (r.status === 403) throw new AccesoError('PERMISSION_DENIED');
  if (!r.ok) {
    throw new AccesoError(`No se pudo guardar (HTTP ${r.status}) en ${ruta}`);
  }
}

async function borrarDoc(ruta: string, idToken: string): Promise<void> {
  const r = await fetch(`${DOCS}/${ruta}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (r.status === 403) throw new AccesoError('PERMISSION_DENIED');
  if (!r.ok && r.status !== 404) {
    throw new AccesoError(`No se pudo borrar (HTTP ${r.status}) ${ruta}`);
  }
}

/**
 * Primera puerta: las coordinadoras no escriben, y punto.
 * La segunda puerta son las reglas de Firestore, que dirían lo mismo aunque
 * alguien se saltara esta.
 */
function exigirAdmin(esAdmin: boolean) {
  if (!esAdmin) {
    throw new AccesoError(
      'Tu cuenta entra como coordinador(a): solo lectura. Registrar o corregir ' +
        'cosas es de administración, y se hace desde la app.',
    );
  }
}

/** Vacía la caché de esta persona (la herramienta "refrescar"). */
export function olvidar(uid: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${uid}:`)) cache.delete(k);
}

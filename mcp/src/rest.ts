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

// Con los emuladores de Firebase encendidos (pruebas: tests/mcp.test.mjs) se
// habla con ellos y con un proyecto de prueba. En Vercel estas variables no
// existen, así que siempre se usa la base real.
const EMU_FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
const EMU_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT_ID = (EMU_FIRESTORE && process.env.GEMB_PROJECT_ID) || 'coordinacion-gemb';
/** Llave pública de la app web: viaja en el bundle del navegador, no es secreta. */
const API_KEY = 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ';

const RAIZ_DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const DOCS = EMU_FIRESTORE
  ? `http://${EMU_FIRESTORE}/v1/${RAIZ_DOCS}`
  : `https://firestore.googleapis.com/v1/${RAIZ_DOCS}`;
const TOKEN_URL = EMU_AUTH
  ? `http://${EMU_AUTH}/securetoken.googleapis.com/v1/token?key=${API_KEY}`
  : `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;

export class ConfigError extends Error {}
export class AccesoError extends Error {}
/**
 * La llave ya no sirve (caducó, la revocaron, la cuenta se borró). Es el
 * único caso que se arregla volviendo a entrar con Google: el servidor
 * responde 401 para que Claude ofrezca "Reconectar" solo.
 */
export class LlaveInvalidaError extends AccesoError {}
/** Al guardar, el documento ya existía (o ya no existía): no se tocó nada. */
export class ConflictoError extends AccesoError {
  constructor(
    message: string,
    readonly motivo: 'ya_existe' | 'no_existe',
  ) {
    super(message);
  }
}

/**
 * Un cambio dentro de un lote. Todos los del lote se guardan juntos o
 * ninguno (como el `writeBatch` de la app).
 *
 *  crear       solo si el documento NO existe. Repetir la misma operación
 *              (Claude confirmando dos veces) no crea nada nuevo.
 *  actualizar  solo esos campos y solo si el documento existe: una ficha
 *              fusionada o una reunión borrada no "resucitan".
 *  borrar      solo si existe: quitar dos veces no resta dos al contador.
 *  sumar       suma atómica a un número, como `increment()` en la app: no
 *              pisa lo que marcan a la vez las coordinadoras.
 */
export type Escritura =
  | { tipo: 'crear'; ruta: string; datos: Record<string, unknown> }
  | { tipo: 'actualizar'; ruta: string; datos: Record<string, unknown> }
  | { tipo: 'borrar'; ruta: string }
  | { tipo: 'sumar'; ruta: string; campo: string; cantidad: number };

export type MemberPublico = Omit<Member, 'phone' | 'notes'>;

export interface Cliente {
  uid: string;
  email: string;
  nombre: string;
  rol: Role;
  /** true = puede escribir. Las coordinadoras solo leen. */
  esAdmin: boolean;
  /** Hasta cuándo vale el permiso de Firestore (ms). */
  expira: number;
  cargarSesiones(): Promise<Session[]>;
  cargarAsistencia(): Promise<Attendance[]>;
  cargarPersonas(): Promise<MemberPublico[]>;
  /** Un solo documento, recién leído (sin caché). null si no existe. */
  leer<T>(ruta: string): Promise<(T & { id: string }) | null>;
  /** La asistencia de UNA reunión, recién leída. */
  asistenciaDe(sessionId: string): Promise<Attendance[]>;
  /** Las asistencias de UNA persona en cualquier reunión, con su ruta. */
  asistenciasDePersona(memberId: string): Promise<{ ruta: string; datos: Attendance }[]>;
  /** Guarda varios cambios juntos (todo o nada). Solo administración. */
  guardar(escrituras: Escritura[]): Promise<void>;
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
  const r = await fetch(TOKEN_URL, {
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
      codigo.startsWith('INVALID_GRANT_TYPE') ||
      codigo.startsWith('MISSING_REFRESH_TOKEN')
    ) {
      throw new LlaveInvalidaError(
        'El acceso ya no sirve (caducó o lo revocaron). ' +
          'Vuelve a conectar el conector desde Claude y entra otra vez con Google.',
      );
    }
    if (codigo.startsWith('USER_DISABLED')) {
      throw new LlaveInvalidaError('Esta cuenta está deshabilitada.');
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
  revisarRespuesta(r);
  if (!r.ok) throw new AccesoError(`Firestore respondió HTTP ${r.status}`);
  return r.json();
}

/** 401 y 403 significan cosas distintas: llave vencida vs. reglas. */
function revisarRespuesta(r: Response) {
  if (r.status === 401) {
    throw new LlaveInvalidaError(
      'El permiso de la sesión venció a mitad de la consulta. Vuelve a intentarlo.',
    );
  }
  if (r.status === 403) throw new AccesoError('PERMISSION_DENIED');
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
    // El pageToken puede traer "+", "/" o "=": sin codificar, la segunda
    // página se pedía mal y se cortaba la lista.
    const url = `${DOCS}/${nombre}?pageSize=300${
      token ? `&pageToken=${encodeURIComponent(token)}` : ''
    }`;
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
    revisarRespuesta(r);
    if (!r.ok) throw new AccesoError(`Firestore respondió HTTP ${r.status} al leer la asistencia`);

    const filas = (await r.json()) as { document?: DocRest }[];
    const docs = filas.map((f) => f.document).filter((d): d is DocRest => !!d);
    for (const d of docs) salida.push(aObjeto<Attendance>(d));

    if (docs.length < TANDA) break;
    ultimo = docs[docs.length - 1].name;
  }
  return salida;
}

/**
 * Las asistencias de una persona, filtradas en el servidor (índice de grupo
 * de colección sobre memberId, el mismo que usa la app al corregir nombres).
 */
async function asistenciasDePersona(
  memberId: string,
  idToken: string,
): Promise<{ ruta: string; datos: Attendance }[]> {
  const r = await fetch(`${DOCS}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'attendance', allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'memberId' },
            op: 'EQUAL',
            value: { stringValue: memberId },
          },
        },
      },
    }),
  });
  revisarRespuesta(r);
  if (!r.ok) throw new AccesoError(`Firestore respondió HTTP ${r.status} al leer el historial`);
  const filas = (await r.json()) as { document?: DocRest }[];
  return filas
    .map((f) => f.document)
    .filter((d): d is DocRest => !!d)
    .map((d) => ({
      ruta: d.name.slice(d.name.indexOf('/documents/') + '/documents/'.length),
      datos: aObjeto<Attendance>(d),
    }));
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
      'Falta entrar con Google. En Claude, toca "Conectar" en este conector y ' +
        'entra con tu cuenta de siempre.',
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
    expira: cred.expira,
    cargarSesiones: () => cacheado('sessions', () => coleccion<Session>('sessions', cred.idToken)),
    cargarAsistencia: () => cacheado('attendance', () => todaLaAsistencia(cred.idToken)),
    cargarPersonas: () =>
      cacheado('members', async () => {
        const todas = await coleccion<Member>('members', cred.idToken);
        // Ni teléfonos ni notas privadas salen de aquí, para nadie.
        return todas.map(({ phone: _p, notes: _n, ...resto }) => resto as MemberPublico);
      }),
    async leer<T>(ruta: string) {
      const d = (await pedir(`${DOCS}/${ruta}`, cred.idToken, true)) as DocRest | null;
      return d ? aObjeto<T & { id: string }>(d) : null;
    },
    asistenciaDe: (sessionId) =>
      coleccion<Attendance>(`sessions/${sessionId}/attendance`, cred.idToken),
    asistenciasDePersona: (memberId) => asistenciasDePersona(memberId, cred.idToken),
    async guardar(escrituras) {
      exigirAdmin(esAdmin);
      try {
        await guardarLote(escrituras, cred.idToken);
      } finally {
        // Es todo o nada, pero aun si falla la caché puede estar vieja.
        olvidar(cred.uid);
      }
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

const nombreDoc = (ruta: string) => `${RAIZ_DOCS}/${ruta}`;

/** Nombres de campo con caracteres raros van entre comillas invertidas. */
const rutaCampo = (campo: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(campo) ? campo : '`' + campo.replace(/[`\\]/g, '\\$&') + '`';

function aEscrituraRest(e: Escritura): Record<string, unknown> {
  switch (e.tipo) {
    case 'crear':
    case 'actualizar': {
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(e.datos)) fields[k] = aValorRest(v);
      return {
        update: { name: nombreDoc(e.ruta), fields },
        // Al crear se escribe el documento entero; al actualizar, SOLO esos
        // campos (lo demás queda como estaba).
        ...(e.tipo === 'actualizar'
          ? { updateMask: { fieldPaths: Object.keys(e.datos).map(rutaCampo) } }
          : {}),
        currentDocument: { exists: e.tipo === 'actualizar' },
      };
    }
    case 'borrar':
      return { delete: nombreDoc(e.ruta), currentDocument: { exists: true } };
    case 'sumar':
      return {
        transform: {
          document: nombreDoc(e.ruta),
          fieldTransforms: [
            { fieldPath: rutaCampo(e.campo), increment: { integerValue: String(e.cantidad) } },
          ],
        },
        currentDocument: { exists: true },
      };
  }
}

async function guardarLote(escrituras: Escritura[], idToken: string): Promise<void> {
  if (escrituras.length === 0) return;
  // Firestore acepta hasta 500 cambios por lote.
  if (escrituras.length > 500) {
    throw new AccesoError('Son demasiados cambios para hacerlos de una vez (más de 500).');
  }
  const r = await fetch(`${DOCS}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: escrituras.map(aEscrituraRest) }),
  });
  if (r.ok) return;
  revisarRespuesta(r);

  let estado = '';
  let detalle = '';
  try {
    const cuerpo = (await r.json()) as { error?: { status?: string; message?: string } };
    estado = cuerpo.error?.status ?? '';
    detalle = cuerpo.error?.message ?? '';
  } catch {
    /* sin cuerpo legible */
  }
  if (r.status === 409 || estado === 'ALREADY_EXISTS') {
    throw new ConflictoError('Ya existía. No se guardó nada.', 'ya_existe');
  }
  if (r.status === 404 || estado === 'NOT_FOUND') {
    throw new ConflictoError('Ya no existe. No se guardó nada.', 'no_existe');
  }
  if (estado === 'FAILED_PRECONDITION' && /exist/i.test(detalle)) {
    throw new ConflictoError(
      'Los datos cambiaron mientras tanto. No se guardó nada.',
      /not exist|no document/i.test(detalle) ? 'no_existe' : 'ya_existe',
    );
  }
  throw new AccesoError(`No se pudo guardar (HTTP ${r.status}${estado ? ` ${estado}` : ''}).`);
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

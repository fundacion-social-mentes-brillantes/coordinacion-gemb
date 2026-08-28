import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cert, applicationDefault, initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Attendance, Member, Session } from '../../src/types';

const PROJECT_ID = 'coordinacion-gemb';

/** Error con instrucciones en castellano llano, para que se pueda arreglar. */
export class ConfigError extends Error {}

/**
 * Dónde guarda gcloud las credenciales de aplicación por defecto (ADC) tras
 * `gcloud auth application-default login`.
 */
function rutaADC(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData
      ? join(appData, 'gcloud', 'application_default_credentials.json')
      : '';
  }
  return join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

/** ¿Hay credenciales de aplicación por defecto disponibles? */
function hayADC(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  // Dentro de Google Cloud (Cloud Run, GCE…) las da la propia máquina.
  if (process.env.GCE_METADATA_HOST || process.env.K_SERVICE) return true;
  const p = rutaADC();
  return !!p && existsSync(p);
}

function credencial() {
  const inline = process.env.GEMB_SERVICE_ACCOUNT?.trim();
  if (inline) {
    // Si alguien escribió "${GEMB_SERVICE_ACCOUNT}" en un .mcp.json y la
    // sustitución no ocurrió, llega el texto literal y el error sería un
    // ENOENT incomprensible. Mejor decir qué pasó.
    if (inline.startsWith('${')) {
      throw new ConfigError(
        `La variable GEMB_SERVICE_ACCOUNT llegó sin sustituir (${inline}). ` +
          'Quita el bloque "env" del .mcp.json: el servidor ya hereda las ' +
          'variables de tu terminal. Y comprueba que la exportaste antes de ' +
          'abrir Claude Code (export GEMB_SERVICE_ACCOUNT="/ruta/a/la-llave.json").',
      );
    }

    // Admite tanto la ruta del archivo como el JSON pegado directamente.
    let texto: string;
    if (inline.startsWith('{')) {
      texto = inline;
    } else {
      try {
        texto = readFileSync(inline, 'utf8');
      } catch {
        throw new ConfigError(
          `No se pudo leer la llave en "${inline}". Comprueba que la ruta existe ` +
            'y que es el archivo .json que descargaste de Firebase ' +
            '(Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada).',
        );
      }
    }

    try {
      return cert(JSON.parse(texto));
    } catch {
      throw new ConfigError(
        'GEMB_SERVICE_ACCOUNT no contiene un JSON de cuenta de servicio válido. ' +
          'Debe ser la ruta al archivo .json que descargaste de Firebase, o su contenido.',
      );
    }
  }
  // Camino recomendado: credenciales de aplicación por defecto (ADC), o sea
  // tu propia cuenta de Google. No hay ningún archivo de llave que descargar
  // ni que se pueda filtrar, y funciona aunque la organización tenga
  // prohibido crear claves de cuenta de servicio.
  if (hayADC()) return applicationDefault();

  throw new ConfigError(
    'No hay credenciales para entrar a Firebase. La forma más sencilla, y la ' +
      'única que funciona si tu organización no deja "Generar nueva clave privada", ' +
      'es entrar con tu propia cuenta de Google:\n\n' +
      '  1. Instala gcloud: https://cloud.google.com/sdk/docs/install\n' +
      '  2. gcloud auth application-default login\n' +
      `  3. gcloud auth application-default set-quota-project ${PROJECT_ID}\n\n` +
      'Se abre el navegador, inicias sesión con la cuenta de la fundación y listo: ' +
      'el permiso queda en tu computador, no hay archivo que compartir. ' +
      'Después reinicia Claude Code.\n\n' +
      'Si en cambio SÍ puedes descargar una llave de cuenta de servicio, define ' +
      'GEMB_SERVICE_ACCOUNT con su ruta. Ver mcp/README.md.',
  );
}

let _db: Firestore | null = null;
function db(): Firestore {
  if (_db) return _db;
  const app =
    getApps()[0] ??
    initializeApp({ credential: credencial(), projectId: PROJECT_ID });
  _db = getFirestore(app);
  return _db;
}

// ---------------------------------------------------------------------------
//  Caché corta: en una misma conversación se hacen varias preguntas seguidas y
//  no tiene sentido releer toda la asistencia cada vez.
// ---------------------------------------------------------------------------
const TTL_MS = 60_000;
interface Cache<T> {
  valor: T;
  hasta: number;
}
const cache = new Map<string, Cache<unknown>>();

async function cacheado<T>(clave: string, cargar: () => Promise<T>): Promise<T> {
  const hit = cache.get(clave);
  if (hit && hit.hasta > Date.now()) return hit.valor as T;
  const valor = await cargar();
  cache.set(clave, { valor, hasta: Date.now() + TTL_MS });
  return valor;
}

export function limpiarCache() {
  cache.clear();
}

export async function cargarSesiones(): Promise<Session[]> {
  return cacheado('sessions', async () => {
    const snap = await db().collection('sessions').get();
    // El id va al final: si el documento guardara un campo 'id', no debe pisar
    // al identificador real del documento.
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as Session);
  });
}

export async function cargarAsistencia(): Promise<Attendance[]> {
  return cacheado('attendance', async () => {
    const snap = await db().collectionGroup('attendance').get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as Attendance);
  });
}

/**
 * Personas de la lista maestra. Se descartan `phone` y `notes` a propósito:
 * son datos de contacto y notas privadas que este servidor no necesita
 * exponer para responder preguntas de asistencia.
 */
export type MemberPublico = Omit<Member, 'phone' | 'notes'>;

export async function cargarPersonas(): Promise<MemberPublico[]> {
  return cacheado('members', async () => {
    const snap = await db().collection('members').get();
    return snap.docs.map((d) => {
      const { phone: _p, notes: _n, ...resto } = d.data() as Member;
      return { ...resto, id: d.id } as MemberPublico;
    });
  });
}

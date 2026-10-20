import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { isAppleMobile, isStandalone } from '../lib/device';
import { auth, db } from '../lib/firebase';
import { activarAvisosNativo, enAppAndroid, ErrorNativo, estadoAvisosNativo } from '../lib/nativo';

// ---------------------------------------------------------------------------
//  El aviso del día antes, «Mañana coordinas tú» (pedido del 19 oct 2026).
//
//  Aquí se registra ESTE teléfono para recibirlo. Lo manda el servidor
//  (api/avisos) todos los días a las 9 a. m. a quien coordina mañana:
//    - en la app de Android, por Firebase Cloud Messaging (versión 1.0.4+);
//    - en iPhone (con la app agregada a la pantalla de inicio) y en los
//      navegadores, por Web Push estándar.
//
//  Cada teléfono es un documento avisos/{uid}__{dispositivo} con el nombre
//  del equipo que le corresponde (el de «Yo la coordino»): el servidor busca
//  por ese nombre en el calendario de mañana.
// ---------------------------------------------------------------------------

/** La llave pública de Web Push. La misma está en mcp/src/avisos.ts. */
const VAPID_PUBLICA = 'BDIoqLNsfEZh0RI-agU5AkzaoeFRG7VbuAobxVYh6rET5KOHRN_EFgd4xaiA7YAW-4YTUz7YUsQ4qH_FA_x1kq0';

export type EstadoAvisos =
  /** Este teléfono ya los recibe. */
  | 'activos'
  /** Se pueden activar con un toque. */
  | 'apagados'
  /** La persona dijo que no: hay que ir a los ajustes del teléfono. */
  | 'bloqueados'
  /** iPhone en Safari: primero hay que agregar la app a la pantalla de inicio. */
  | 'instalar-ios'
  /** App de Android anterior a la 1.0.4. */
  | 'actualizar-app'
  /** Navegador sin avisos (iPhone viejo, navegador raro…). */
  | 'sin-soporte';

export class ErrorAvisos extends Error {
  constructor(
    mensaje: string,
    readonly estado: EstadoAvisos | 'version-vieja',
  ) {
    super(mensaje);
  }
}

// ------------------------------------------------- lo guardado en el teléfono

interface Registro {
  uid: string;
  nombre: string;
  /** El token o la dirección con que se registró, para notar si cambia. */
  huella: string;
}

const CLAVE = 'gemb:avisos';
const CLAVE_DISPOSITIVO = 'gemb:dispositivo';

function leerRegistro(): Registro | null {
  try {
    const r = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Registro | null;
    return r && typeof r.uid === 'string' ? r : null;
  } catch {
    return null;
  }
}

function recordar(r: Registro | null) {
  try {
    if (r) localStorage.setItem(CLAVE, JSON.stringify(r));
    else localStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: se registra de nuevo la próxima vez */
  }
}

/** Un nombre al azar para este teléfono, el mismo siempre. */
function dispositivo(): string {
  try {
    let id = localStorage.getItem(CLAVE_DISPOSITIVO);
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const b = crypto.getRandomValues(new Uint8Array(15));
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
      localStorage.setItem(CLAVE_DISPOSITIVO, id);
    }
    return id;
  } catch {
    return 'sin-almacenamiento';
  }
}

const idDoc = (uid: string) => `${uid}__${dispositivo()}`;

// ------------------------------------------------------------- web push

const soportaWebPush = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function aBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/**
 * ¿El service worker activo ya sabe mostrar avisos (public/avisos-sw.js)? Si
 * alguien se suscribe con la versión vieja, los avisos llegarían sin mostrarse
 * y el iPhone le quita el permiso a la app.
 */
function swConAvisos(reg: ServiceWorkerRegistration): Promise<boolean> {
  const sw = reg.active;
  if (!sw) return Promise.resolve(false);
  return new Promise((ok) => {
    const canal = new MessageChannel();
    const t = setTimeout(() => ok(false), 1500);
    canal.port1.onmessage = (e) => {
      clearTimeout(t);
      ok(e.data === 'gemb:avisos-si');
    };
    sw.postMessage('gemb:avisos?', [canal.port2]);
  });
}

// ------------------------------------------------------------------ estado

/** ¿Recibe avisos este teléfono, para esta cuenta? Sin preguntar nada. */
export async function estadoAvisos(uid: string): Promise<EstadoAvisos> {
  const reg = leerRegistro();
  const mio = reg?.uid === uid;
  if (enAppAndroid) {
    try {
      const e = await estadoAvisosNativo();
      if (!mio) return 'apagados';
      return e.permiso ? 'activos' : 'bloqueados';
    } catch (e) {
      if (e instanceof ErrorNativo && e.codigo === 'desconocida') return 'actualizar-app';
      return 'sin-soporte';
    }
  }
  if (!soportaWebPush()) return isAppleMobile() && !isStandalone() ? 'instalar-ios' : 'sin-soporte';
  if (Notification.permission === 'denied') return 'bloqueados';
  if (!mio || Notification.permission !== 'granted') return 'apagados';
  const sw = await navigator.serviceWorker.getRegistration();
  const sub = await sw?.pushManager.getSubscription();
  return sub ? 'activos' : 'apagados';
}

// ---------------------------------------------------------------- activar

async function guardar(uid: string, nombre: string, datos: Record<string, unknown>, huella: string) {
  await setDoc(doc(db, 'avisos', idDoc(uid)), { uid, nombre, ...datos, updatedAt: serverTimestamp() });
  recordar({ uid, nombre, huella });
}

async function suscripcionWeb(preguntar: boolean): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  if (!(await swConAvisos(reg))) {
    // Que se instale la versión nueva (recarga la app) y luego se vuelva a tocar.
    window.dispatchEvent(new Event('gemb:do-update'));
    throw new ErrorAvisos('La app se está actualizando. Cuando abra de nuevo, vuelve a tocar «Activar avisos».', 'version-vieja');
  }
  const existente = await reg.pushManager.getSubscription();
  if (existente || !preguntar) return existente;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(VAPID_PUBLICA) });
}

const datosWeb = (s: PushSubscription) => {
  const j = s.toJSON();
  return {
    plataforma: 'web',
    suscripcion: { endpoint: j.endpoint ?? '', p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' },
  };
};

/**
 * Activa los avisos en este teléfono. Hay que llamarla JUSTO al tocar el
 * botón: el iPhone solo pregunta el permiso si viene de un toque.
 */
export async function activarAvisos(uid: string, nombre: string): Promise<void> {
  if (!nombre) throw new ErrorAvisos('Primero elige tu nombre en Coordinación.', 'apagados');
  if (enAppAndroid) {
    let token: string;
    try {
      ({ token } = await activarAvisosNativo());
    } catch (e) {
      if (e instanceof ErrorNativo && e.codigo === 'desconocida') {
        throw new ErrorAvisos('Actualiza la app desde Google Play para recibir avisos.', 'actualizar-app');
      }
      if (e instanceof ErrorNativo && e.codigo === 'sin-permiso') {
        throw new ErrorAvisos('Los avisos de la app están apagados en el teléfono.', 'bloqueados');
      }
      throw e;
    }
    await guardar(uid, nombre, { plataforma: 'android', token }, token);
    return;
  }
  if (!soportaWebPush()) {
    throw new ErrorAvisos(
      isAppleMobile() && !isStandalone()
        ? 'En iPhone, primero agrega la app a la pantalla de inicio.'
        : 'Este navegador no puede mostrar avisos.',
      isAppleMobile() && !isStandalone() ? 'instalar-ios' : 'sin-soporte',
    );
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') throw new ErrorAvisos('No se dio permiso para los avisos.', 'bloqueados');
  const sub = await suscripcionWeb(true);
  if (!sub) throw new ErrorAvisos('No se pudo activar.', 'sin-soporte');
  await guardar(uid, nombre, datosWeb(sub), sub.endpoint);
}

/**
 * Al abrir la app: si este teléfono ya tenía los avisos, se pone al día en
 * silencio (token nuevo, otro nombre). No pregunta nada.
 */
export async function mantenerAvisos(uid: string, nombre: string): Promise<void> {
  const reg = leerRegistro();
  if (!reg || reg.uid !== uid || !nombre) return;
  if (enAppAndroid) {
    const e = await estadoAvisosNativo().catch(() => null);
    if (!e?.permiso || !e.token) return;
    if (e.token !== reg.huella || nombre !== reg.nombre) {
      await guardar(uid, nombre, { plataforma: 'android', token: e.token }, e.token);
    }
    return;
  }
  if (!soportaWebPush() || Notification.permission !== 'granted') return;
  const sub = await suscripcionWeb(false).catch(() => null);
  if (sub && (sub.endpoint !== reg.huella || nombre !== reg.nombre)) {
    await guardar(uid, nombre, datosWeb(sub), sub.endpoint);
  }
}

export async function apagarAvisos(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'avisos', idDoc(uid)));
  recordar(null);
  if (!enAppAndroid && soportaWebPush()) {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => false);
  }
}

/** Manda un aviso de muestra a los teléfonos de esta cuenta. */
export async function probarAviso(): Promise<{ dispositivos: number; enviados: number }> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Vuelve a entrar a la app.');
  const r = await fetch('/api/avisos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'prueba' }),
  });
  const d = (await r.json().catch(() => ({}))) as { error?: string; dispositivos?: number; enviados?: number };
  if (!r.ok) throw new Error(d.error || 'No se pudo mandar el aviso de prueba.');
  return { dispositivos: d.dispositivos ?? 0, enviados: d.enviados ?? 0 };
}

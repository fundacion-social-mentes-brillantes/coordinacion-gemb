/**
 * La app de Android (carpeta android/): la misma página dentro de una app
 * nativa, para tener la burbuja flotante encima de Meet.
 *
 * Desde aquí se habla con lo nativo a través del objeto `GembNativo`, que el
 * WebView de la app pone en la página (ver android/.../Puente.java). En el
 * navegador ese objeto no existe y todo sigue como siempre.
 *
 * Por qué no los plugins de Capacitor: la app carga la versión publicada, con
 * su service worker, y el código que Capacitor inyecta en el HTML no siempre
 * llega. `GembNativo` lo pone el propio WebView en cada página.
 */

interface PuenteNativo {
  postMessage(mensaje: string): void;
  onmessage: ((e: { data: string }) => void) | null;
}

interface Respuesta {
  id: string;
  ok: boolean;
  datos?: unknown;
  codigo?: string;
  mensaje?: string;
}

/** Error que viene del teléfono, con un código para decidir qué decir. */
export class ErrorNativo extends Error {
  constructor(
    mensaje: string,
    public codigo: string,
  ) {
    super(mensaje);
  }
}

const puente: PuenteNativo | undefined =
  typeof window !== 'undefined'
    ? (window as unknown as { GembNativo?: PuenteNativo }).GembNativo
    : undefined;

/** ¿Estamos dentro de la app de Android (con el puente funcionando)? */
export const enAppAndroid = !!puente;

/**
 * ¿Dentro de la app, aunque el puente faltara (WebView muy viejo)? La app
 * marca su navegador con "GembAndroid".
 */
export const enAppAndroidAunqueSinPuente =
  enAppAndroid || (typeof navigator !== 'undefined' && /GembAndroid/.test(navigator.userAgent));

/** ¿Un Android en el navegador normal? (Ahí se ofrece bajar la app.) */
export const androidEnNavegador =
  !enAppAndroidAunqueSinPuente && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/** ¿Es la pantalla de la burbuja? */
export const esBurbuja = () => window.location.pathname.startsWith('/burbuja');

const MARCA_BURBUJA = 'gemb:ventana-burbuja';

/**
 * ¿Esta ventana es la de la burbuja, aunque ahora muestre otra ruta (por
 * ejemplo /login tras salir)? main.tsx la marca al arrancar en /burbuja; la
 * marca vive en el sessionStorage de este WebView y sobrevive a recargas.
 */
export function esVentanaBurbuja(): boolean {
  try {
    return sessionStorage.getItem(MARCA_BURBUJA) === '1';
  } catch {
    return esBurbuja();
  }
}

export function marcarVentanaBurbuja() {
  if (!esBurbuja()) return;
  try {
    sessionStorage.setItem(MARCA_BURBUJA, '1');
  } catch {
    /* sin almacenamiento: se usa la ruta */
  }
}

/** A dónde va «inicio» en esta ventana: la reunión de hoy en la burbuja. */
export const inicioDeLaVentana = () => (esVentanaBurbuja() ? '/burbuja' : '/sesiones');

let siguiente = 0;
const pendientes = new Map<string, { ok: (v: unknown) => void; mal: (e: Error) => void }>();

if (puente) {
  puente.onmessage = (e) => {
    let r: Respuesta;
    try {
      r = JSON.parse(e.data) as Respuesta;
    } catch {
      return;
    }
    const p = pendientes.get(r.id);
    if (!p) return;
    pendientes.delete(r.id);
    if (r.ok) p.ok(r.datos ?? null);
    else p.mal(new ErrorNativo(r.mensaje || 'El teléfono no pudo hacerlo.', r.codigo || 'fallo'));
  };
}

function pedir<T = null>(
  accion: string,
  datos: Record<string, unknown> = {},
  limiteMs = 0,
): Promise<T> {
  const p = puente;
  if (!p) return Promise.reject(new ErrorNativo('Esto solo funciona en la app de Android.', 'sin-app'));
  const id = `m${++siguiente}`;
  return new Promise<T>((ok, mal) => {
    pendientes.set(id, { ok: ok as (v: unknown) => void, mal });
    // Un tiempo límite para lo que no espera a la persona (compartir): si el
    // teléfono nunca responde, la ruedita no se queda girando para siempre.
    if (limiteMs > 0) {
      setTimeout(() => {
        if (!pendientes.delete(id)) return;
        mal(new ErrorNativo('El teléfono no respondió a tiempo.', 'tiempo'));
      }, limiteMs);
    }
    try {
      p.postMessage(JSON.stringify({ ...datos, id, accion }));
    } catch (e) {
      pendientes.delete(id);
      mal(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// ------------------------------------------------------------------ utilidades

/** Copia un texto. Lanza error si no se pudo (igual que el portapapeles web). */
export async function copiarTexto(texto: string): Promise<void> {
  if (puente) {
    await pedir('copiar', { texto });
    return;
  }
  await navigator.clipboard.writeText(texto);
}

function aBase64(blob: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => {
      const url = String(lector.result || '');
      ok(url.slice(url.indexOf(',') + 1));
    };
    lector.onerror = () => mal(lector.error || new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(blob);
  });
}

/** Más que esto, en un teléfono modesto, no cabe en memoria de una vez. */
const MAXIMO_PARA_COMPARTIR = 20 * 1024 * 1024;

/** Comparte un archivo con el menú de Android (WhatsApp, Drive, Guardar…). */
export async function compartirArchivo(blob: Blob, nombre: string, texto = ''): Promise<void> {
  if (blob.size > MAXIMO_PARA_COMPARTIR) {
    throw new ErrorNativo('El archivo es muy grande para compartirlo desde la app.', 'grande');
  }
  const datos = await aBase64(blob);
  await pedir('compartir', { datos, nombre, mime: blob.type || 'application/octet-stream', texto }, 60_000);
}

/**
 * Pantalla segura: mientras está abierta la carpeta, Android no deja tomar
 * pantallazos ni grabar la pantalla (salen en negro). Lo pidió la
 * coordinación: la carpeta no debe salir de la app. Las versiones de la app
 * anteriores a la 1.0.3 no conocen la acción y se ignora el error.
 */
export function pantallaSegura(activa: boolean) {
  if (!puente) return;
  pedir('pantallaSegura', { activa }).catch(() => null);
}

// --------------------------------------------------------- entrar con Google

/**
 * Google no deja entrar desde un WebView: la app abre el selector de cuentas
 * del teléfono y devuelve el token con el que la página entra a Firebase.
 */
export async function tokenDeGoogle(): Promise<string> {
  const r = await pedir<{ idToken: string }>('entrarGoogle');
  return r.idToken;
}

/** Ajustes → Agregar cuenta de Google (cuando el teléfono no tiene ninguna). */
export const agregarCuentaDeGoogle = () => pedir('agregarCuenta');

/** Para que la próxima vez vuelva a preguntar con qué cuenta entrar. */
export async function olvidarCuentaDeGoogle(): Promise<void> {
  if (!enAppAndroid) return;
  await pedir('salirGoogle').catch(() => null);
}

// ------------------------------------------------------------------- burbuja

export interface EstadoBurbuja {
  /** Android 11 o más nuevo y no «Android Go» (esos nunca muestran burbujas). */
  soportada: boolean;
  /** El interruptor de burbujas de todo el teléfono (Samsung: «Notificaciones flotantes»). */
  general?: boolean;
  /** La categoría «Burbuja de la reunión» apagada desde el aviso. */
  canalApagado?: boolean;
  /** ¿La app tiene permiso de mostrar avisos? */
  avisos: boolean;
  /** Lo que eligió la persona en Ajustes para las burbujas de esta app. */
  preferencia: 'todas' | 'seleccionadas' | 'ninguna' | 'desconocida';
  /** ¿Está el aviso puesto? */
  visible: boolean;
  /** ¿Android lo está mostrando como burbuja? */
  flotando: boolean;
}

export const mostrarBurbuja = () => pedir<EstadoBurbuja>('burbuja');
export const estadoBurbuja = () => pedir<EstadoBurbuja>('estadoBurbuja');
export const cerrarBurbuja = () => pedir('cerrarBurbuja');
export const ajustesDeBurbujas = () => pedir('ajustesBurbuja');
export const ajustesDeAvisos = () => pedir('ajustesAvisos');
/** Desde la burbuja: abre la app completa. */
export const abrirLaApp = () => pedir('abrirApp');

// ------------------------------------------------- aviso del día antes (1.0.4)

/**
 * Pide permiso de avisos (Android 13+) y devuelve el token de Firebase Cloud
 * Messaging de este teléfono. Las versiones anteriores a la 1.0.4 responden
 * «desconocida»: ahí hay que actualizar la app.
 */
export const activarAvisosNativo = () => pedir<{ token: string }>('avisos');
/** Sin preguntar nada: ¿hay permiso? y, si lo hay, el token actual. */
export const estadoAvisosNativo = () => pedir<{ permiso: boolean; token?: string }>('estadoAvisos', {}, 8000);

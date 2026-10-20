import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type ECDH, type KeyObject } from 'node:crypto';
import { avisoDiaAntes, AVISO_DE_PRUEBA } from '../../src/lib/mensajesCoordina';
import {
  completarConfig,
  hayReunion,
  moverDia,
  planDeFecha,
  type DiaProgramado,
  type FechaPlan,
  type ProgramacionConfig,
} from '../../src/lib/programacion';
import { campos } from './rest';

// ---------------------------------------------------------------------------
//  «Mañana coordinas tú»: el aviso del día antes (pedido del 19 oct 2026).
//
//  Todos los días a las 9 a. m. (cron de Vercel) se mira el calendario de
//  mañana y, si hay reunión con coordinadora, se le avisa a cada teléfono que
//  ella registró en la app (colección `avisos`):
//    - app de Android → Firebase Cloud Messaging (lo más confiable en Xiaomi);
//    - iPhone y navegadores → Web Push estándar, cifrado aquí mismo.
//
//  SIN LLAVES: la organización no deja crear llaves de cuenta de servicio.
//  Vercel firma cada llamada con su propio certificado (OIDC) y Google lo
//  cambia por un permiso de una hora de la cuenta `avisos-vercel`
//  (federación de identidad). Esa cuenta solo puede leer/escribir Firestore y
//  mandar avisos. El único secreto propio es la llave de Web Push
//  (VAPID_PRIVADA en Vercel), que solo sirve para mandar avisos de esta app.
//
//  Sin dependencias: solo fetch y node:crypto.
// ---------------------------------------------------------------------------

const PROYECTO = 'coordinacion-gemb';
const PROYECTO_NUMERO = '1019293780998';
const CUENTA = `avisos-vercel@${PROYECTO}.iam.gserviceaccount.com`;
const AUDIENCIA_WIF = `//iam.googleapis.com/projects/${PROYECTO_NUMERO}/locations/global/workloadIdentityPools/vercel/providers/vercel`;

/** La llave pública de Web Push. La misma está en src/lib/avisos.ts. */
export const VAPID_PUBLICA = 'BDIoqLNsfEZh0RI-agU5AkzaoeFRG7VbuAobxVYh6rET5KOHRN_EFgd4xaiA7YAW-4YTUz7YUsQ4qH_FA_x1kq0';
/** A quién escribir si algo falla (Apple exige un mailto: o una https). */
const CONTACTO_VAPID = 'https://coordinacion-gemb.vercel.app';

/** Lo que se le muestra a la persona. */
export interface Aviso {
  titulo: string;
  cuerpo: string;
  /** Pantalla que se abre al tocarlo. */
  ruta: string;
  /** Avisos con la misma etiqueta se reemplazan (si llega dos veces, se ve uno). */
  etiqueta: string;
}

export interface SuscripcionWeb {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Un teléfono (o navegador) que pidió los avisos. */
export interface Dispositivo {
  ruta: string;
  uid: string;
  nombre: string;
  plataforma: 'android' | 'web';
  token?: string;
  suscripcion?: SuscripcionWeb;
}

export type Resultado = 'ok' | 'caducado' | 'error';

/** Cómo hablar con Google: la dirección de Firestore y el permiso. */
export interface Google {
  docs: string;
  token: string;
}

export const docsDe = (base = `https://firestore.googleapis.com/v1`, proyecto = PROYECTO) =>
  `${base}/projects/${proyecto}/databases/(default)/documents`;

// ------------------------------------------------------------- el permiso

/**
 * Canjea el certificado de Vercel (OIDC) por un permiso de una hora de la
 * cuenta avisos-vercel. Dos pasos: Google STS lo cambia por un permiso
 * federado y IAM Credentials lo convierte en el de la cuenta.
 */
export async function permisoDeServidor(oidc: string): Promise<{ token: string; hasta: number }> {
  const r1 = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: AUDIENCIA_WIF,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: oidc,
    }),
  });
  const d1 = (await r1.json()) as { access_token?: string; error_description?: string };
  if (!r1.ok || !d1.access_token) throw new Error(`STS: ${d1.error_description ?? r1.status}`);
  const r2 = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${CUENTA}:generateAccessToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${d1.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'] }),
    },
  );
  const d2 = (await r2.json()) as { accessToken?: string; expireTime?: string; error?: { message?: string } };
  if (!r2.ok || !d2.accessToken) throw new Error(`IAM: ${d2.error?.message ?? r2.status}`);
  return { token: d2.accessToken, hasta: Date.parse(d2.expireTime ?? '') || Date.now() + 50 * 60_000 };
}

// ------------------------------------------------------------- Firestore

async function leerDoc(g: Google, ruta: string): Promise<Record<string, unknown> | null> {
  const r = await fetch(`${g.docs}/${ruta}`, { headers: { Authorization: `Bearer ${g.token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${ruta}: HTTP ${r.status}`);
  const d = (await r.json()) as { fields?: Record<string, unknown> };
  return campos(d.fields);
}

/** El plan de una fecha, leído del calendario. null si no hay nada. */
export async function planDe(g: Google, key: string): Promise<FechaPlan | null> {
  const [config, dia] = await Promise.all([leerDoc(g, 'programacion/config'), leerDoc(g, `programacion_dias/${key}`)]);
  const dias = new Map<string, DiaProgramado>();
  if (dia) dias.set(key, dia as unknown as DiaProgramado);
  return planDeFecha(key, completarConfig((config ?? undefined) as Partial<ProgramacionConfig> | undefined), dias);
}

/** Los dispositivos con ese nombre (o de esa cuenta). */
export async function dispositivos(g: Google, campo: 'nombre' | 'uid', valor: string): Promise<Dispositivo[]> {
  const r = await fetch(`${g.docs}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'avisos' }],
        where: { fieldFilter: { field: { fieldPath: campo }, op: 'EQUAL', value: { stringValue: valor } } },
        limit: 50,
      },
    }),
  });
  if (!r.ok) throw new Error(`Firestore avisos: HTTP ${r.status}`);
  const filas = (await r.json()) as { document?: { name: string; fields?: Record<string, unknown> } }[];
  const salida: Dispositivo[] = [];
  for (const f of filas) {
    if (!f.document) continue;
    const c = campos(f.document.fields) as Partial<Dispositivo>;
    if (c.plataforma !== 'android' && c.plataforma !== 'web') continue;
    salida.push({
      ruta: f.document.name.split('/documents/')[1] ?? '',
      uid: String(c.uid ?? ''),
      nombre: String(c.nombre ?? ''),
      plataforma: c.plataforma,
      token: typeof c.token === 'string' ? c.token : undefined,
      suscripcion: c.suscripcion,
    });
  }
  return salida;
}

async function borrar(g: Google, ruta: string): Promise<void> {
  await fetch(`${g.docs}/${ruta}`, { method: 'DELETE', headers: { Authorization: `Bearer ${g.token}` } }).catch(() => {});
}

// ----------------------------------------------------------- Android (FCM)

export async function enviarFcm(g: Google, token: string, a: Aviso): Promise<Resultado> {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROYECTO}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        // Con «notification» la muestra el propio Android aunque la app esté
        // cerrada; «data» es para cuando está abierta (AvisosServicio.java).
        notification: { title: a.titulo, body: a.cuerpo },
        data: { titulo: a.titulo, cuerpo: a.cuerpo, ruta: a.ruta, etiqueta: a.etiqueta },
        android: {
          priority: 'HIGH',
          ttl: '72000s',
          notification: { channel_id: 'coordinar', icon: 'ic_aviso', color: '#D6B064', tag: a.etiqueta },
        },
      },
    }),
  });
  if (r.ok) return 'ok';
  const d = (await r.json().catch(() => ({}))) as {
    error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
  };
  const codigos = (d.error?.details ?? []).map((x) => x.errorCode);
  if (r.status === 404 || codigos.includes('UNREGISTERED')) return 'caducado';
  if (r.status === 400 && /registration token/i.test(d.error?.message ?? '')) return 'caducado';
  console.warn('FCM no aceptó el aviso', r.status, d.error?.status, d.error?.message);
  return 'error';
}

// --------------------------------------------------- iPhone y navegadores

const hmac = (llave: Buffer, datos: Buffer) => createHmac('sha256', llave).update(datos).digest();
const b64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * Cifra el aviso como manda el estándar de Web Push (RFC 8291, aes128gcm):
 * solo el navegador de la persona lo puede abrir, ni Apple ni Google lo ven.
 * `sal` y `efimera` se pasan solo en las pruebas (vector del RFC).
 */
export function cifrarWebPush(texto: string, sub: { p256dh: string; auth: string }, sal = randomBytes(16), efimera?: ECDH): Buffer {
  const ua = b64(sub.p256dh);
  const secreto = b64(sub.auth);
  let e = efimera;
  if (!e) {
    e = createECDH('prime256v1');
    e.generateKeys();
  }
  const nuestra = e.getPublicKey();
  const compartido = e.computeSecret(ua);
  const ikm = hmac(hmac(secreto, compartido), Buffer.concat([Buffer.from('WebPush: info\0'), ua, nuestra, Buffer.from([1])]));
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  // El 0x02 final marca «último bloque, sin relleno».
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const cabecera = Buffer.alloc(21);
  sal.copy(cabecera, 0);
  cabecera.writeUInt32BE(4096, 16);
  cabecera.writeUInt8(nuestra.length, 20);
  return Buffer.concat([cabecera, nuestra, cifrado]);
}

/** La llave privada de Web Push (VAPID_PRIVADA, base64url de 32 bytes). */
export function llaveVapid(privada: string, publica = VAPID_PUBLICA): KeyObject {
  const pub = b64(publica);
  const d = b64(privada);
  const d32 = d.length >= 32 ? d.subarray(d.length - 32) : Buffer.concat([Buffer.alloc(32 - d.length), d]);
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d32.toString('base64url'),
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
}

/** La firma que le dice al servicio de avisos (Apple, Google…) que somos nosotros. */
export function firmaVapid(endpoint: string, llave: KeyObject, publica = VAPID_PUBLICA): string {
  const parte = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${parte({ typ: 'JWT', alg: 'ES256' })}.${parte({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: CONTACTO_VAPID,
  })}`;
  const firma = sign('sha256', Buffer.from(cuerpo), { key: llave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cuerpo}.${firma.toString('base64url')}, k=${publica}`;
}

export async function enviarWeb(sub: SuscripcionWeb, a: Aviso, llave: KeyObject): Promise<Resultado> {
  let r: Response;
  try {
    r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: firmaVapid(sub.endpoint, llave),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '72000',
        Urgency: 'high',
      },
      body: Uint8Array.from(cifrarWebPush(JSON.stringify(a), sub)),
    });
  } catch (e) {
    console.warn('No se pudo llegar al servicio de avisos', e);
    return 'error';
  }
  if (r.ok) return 'ok';
  // 404/410: esa suscripción ya no existe (desinstaló la app, borró datos…).
  if (r.status === 404 || r.status === 410) return 'caducado';
  console.warn('El servicio de avisos no aceptó', r.status, (await r.text().catch(() => '')).slice(0, 200));
  return 'error';
}

// ------------------------------------------------------------- el reparto

export interface Enviadores {
  fcm: (token: string, a: Aviso) => Promise<Resultado>;
  web: (sub: SuscripcionWeb, a: Aviso) => Promise<Resultado>;
}

export function enviadoresReales(g: Google, vapidPrivada: string | undefined): Enviadores {
  const llave = vapidPrivada ? llaveVapid(vapidPrivada) : null;
  return {
    fcm: (token, a) => enviarFcm(g, token, a),
    web: async (sub, a) => {
      if (!llave) {
        console.warn('Falta VAPID_PRIVADA: no se pueden mandar avisos web');
        return 'error';
      }
      return enviarWeb(sub, a, llave);
    },
  };
}

export interface Reparto {
  enviados: number;
  caducados: number;
  fallidos: number;
}

/** Manda el aviso a cada dispositivo; los que ya no existen se borran. */
export async function repartir(g: Google, lista: Dispositivo[], a: Aviso, env: Enviadores): Promise<Reparto> {
  const r: Reparto = { enviados: 0, caducados: 0, fallidos: 0 };
  await Promise.all(
    lista.map(async (d) => {
      let res: Resultado = 'error';
      if (d.plataforma === 'android' && d.token) res = await env.fcm(d.token, a);
      else if (d.plataforma === 'web' && d.suscripcion?.endpoint) res = await env.web(d.suscripcion, a);
      if (res === 'ok') r.enviados++;
      else if (res === 'caducado') {
        r.caducados++;
        await borrar(g, d.ruta);
      } else r.fallidos++;
    }),
  );
  return r;
}

/** El día de hoy en Bogotá, "aaaa-mm-dd". */
export const hoyEnBogota = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);

export interface ResumenDiario extends Partial<Reparto> {
  fecha: string;
  coordinadora: string;
  motivo?: string;
}

/** El trabajo del cron: avisar a quien coordina mañana. */
export async function avisarManana(g: Google, env: Enviadores, hoy = hoyEnBogota()): Promise<ResumenDiario> {
  const fecha = moverDia(hoy, 1);
  const p = await planDe(g, fecha);
  if (!p || !hayReunion(p)) return { fecha, coordinadora: '', motivo: 'no hay reunión' };
  if (!p.coordinadora) return { fecha, coordinadora: '', motivo: 'sin coordinadora' };
  const lista = await dispositivos(g, 'nombre', p.coordinadora);
  if (!lista.length) return { fecha, coordinadora: p.coordinadora, motivo: 'no activó los avisos', enviados: 0 };
  const tipo = p.actividades[0] ?? 'reduccion_ego';
  const aviso: Aviso = { ...avisoDiaAntes(p, tipo), ruta: '/sesiones', etiqueta: `coordinar-${fecha}` };
  return { fecha, coordinadora: p.coordinadora, ...(await repartir(g, lista, aviso, env)) };
}

/** «Probar aviso»: uno de muestra a los dispositivos de esa cuenta. */
export async function avisoDePrueba(g: Google, env: Enviadores, uid: string): Promise<Reparto & { dispositivos: number }> {
  const lista = await dispositivos(g, 'uid', uid);
  const aviso: Aviso = { ...AVISO_DE_PRUEBA, ruta: '/sesiones', etiqueta: 'prueba' };
  return { dispositivos: lista.length, ...(await repartir(g, lista, aviso, env)) };
}

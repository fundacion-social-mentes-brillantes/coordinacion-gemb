// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import authHosts from './authHosts.json';

/**
 * DOMINIO DE AUTENTICACIÓN — por qué esto importa (sobre todo en iPhone)
 * ---------------------------------------------------------------------
 * Para entrar con Google, Firebase usa una página "ayudante" que vive en
 * `/__/auth/handler`. Si esa página vive en OTRO dominio
 * (coordinacion-gemb.firebaseapp.com), Safari/iOS la trata como "de un
 * tercero" y le bloquea el almacenamiento: la sesión se pierde en el camino
 * y el iPhone vuelve a la pantalla de ingreso como si nada hubiera pasado.
 *
 * La solución es que el ayudante viva en NUESTRO propio dominio. Eso ya está
 * resuelto en `vercel.json`, que reenvía `/__/auth/*` a Firebase. Aquí solo
 * hay que decirle al SDK que use nuestro dominio.
 *
 * En `localhost` (desarrollo) y en los despliegues de prueba de Vercel ese
 * reenvío existe pero el dominio no está registrado en Google, así que ahí se
 * sigue usando el dominio de Firebase de siempre.
 */
// Dominios propios de la app que YA están registrados en Google Cloud
// (Orígenes autorizados + URI de redireccionamiento `/__/auth/handler`).
// La lista vive en `authHosts.json` para que el build la pueda comprobar.
//
// ⚠️ SI LA LISTA ESTÁ VACÍA, ES A PROPÓSITO. No es un olvido.
//
// Poner ahí un dominio ANTES de registrarlo en Google Cloud rompe el ingreso
// para TODO EL MUNDO, no solo en iPhone: Google responde `redirect_uri_mismatch`
// y nadie puede entrar. Pasó exactamente eso el 2026-08-28 al desplegar con
// 'coordinacion-gemb.vercel.app' en la lista sin haber hecho antes el registro.
//
// EL ORDEN CORRECTO ES:
//   1. Google Cloud → APIs y servicios → Credenciales → el cliente OAuth de
//      web (id 1019293780998-rgi4eu70dekg9id9172e4tp5mg5jr39f). Añadir
//      https://coordinacion-gemb.vercel.app/__/auth/handler a "URI de
//      redireccionamiento autorizados", y el dominio a "Orígenes autorizados".
//   2. Añadir el dominio a `authHosts.json` y correr `npm run check:auth`, que
//      le pregunta a Google si ya lo acepta sin tocar nada.
//   3. Desplegar. El build vuelve a correr esa comprobación y se DETIENE si
//      Google no acepta algún dominio de la lista, así que un error en el
//      orden ya no llega a producción: se queda en un build fallido.
//
// Mientras la lista esté vacía se usa el dominio de Firebase de siempre. Todo
// el mundo puede entrar; en el iPhone se entra por ventana emergente, y la app
// instalada en el iPhone no puede entrar (ver `signIn` en AuthContext).
const APP_HOSTS: readonly string[] = authHosts;
const FIREBASE_DOMAIN = 'coordinacion-gemb.firebaseapp.com';

function resolveAuthDomain(): string {
  if (typeof window === 'undefined') return FIREBASE_DOMAIN;
  const host = window.location.hostname;
  if (APP_HOSTS.includes(host)) return host;
  // En localhost es lo normal y esperado. En cualquier otro dominio conviene
  // avisar: significa que el iPhone usará el camino frágil.
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.warn(
      `[GEMB] El dominio "${host}" no está en src/lib/authHosts.json. ` +
        'El ingreso con Google puede fallar en iPhone. Ver el paso 4b del README.',
    );
  }
  return FIREBASE_DOMAIN;
}

const AUTH_DOMAIN = resolveAuthDomain();

/**
 * ¿El ayudante de Google vive en nuestro propio dominio?
 *
 * De esto depende qué método de ingreso sirve en el iPhone: la redirección
 * solo funciona ahí si es `true`. Ver `signIn` en AuthContext.
 */
export const authIsFirstParty =
  typeof window !== 'undefined' && AUTH_DOMAIN === window.location.hostname;

// Estas llaves NO son secretas: viajan en el bundle del navegador.
// La seguridad real la dan las reglas de Firestore y el login de Google.
// (scripts/check-auth-hosts.mjs repite la apiKey: si cambia, cambiarla allí.)
const firebaseConfig = {
  apiKey: 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ',
  authDomain: AUTH_DOMAIN,
  projectId: 'coordinacion-gemb',
  storageBucket: 'coordinacion-gemb.firebasestorage.app',
  messagingSenderId: '1019293780998',
  appId: '1:1019293780998:web:5f6c2d4adb72291cc4c787',
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

/**
 * Sesión persistente: la usuaria NO debe desloguearse sola.
 *
 * Se exporta la promesa para poder ESPERARLA antes de iniciar sesión: si el
 * login arranca antes de que la persistencia esté fijada, la sesión puede
 * guardarse en el lugar equivocado y perderse al recargar (justo lo que
 * pasaba en el iPhone).
 */
export const authReady: Promise<void> = setPersistence(
  auth,
  browserLocalPersistence,
).catch((e) => {
  // Algunos navegadores en modo privado bloquean la persistencia; no es fatal.
  console.warn('No se pudo fijar la persistencia de Auth:', e);
});

export const googleProvider = new GoogleAuthProvider();
// Fuerza a mostrar el selector de cuentas de Google.
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Firestore con persistencia offline (multi-pestaña).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// Correo del super-administrador (admin de admins).
export const SUPER_ADMIN_EMAIL = 'fundacionsocial@gimnasioemocionalmb.com';

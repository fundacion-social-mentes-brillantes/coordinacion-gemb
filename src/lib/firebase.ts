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
// Si algún día la app cambia de dominio, hay que añadirlo AQUÍ y registrarlo
// en Google Cloud (paso 4b del README). Sin las dos cosas, el iPhone se
// vuelve a romper.
const APP_HOSTS = ['coordinacion-gemb.vercel.app'];
const FIREBASE_DOMAIN = 'coordinacion-gemb.firebaseapp.com';

function resolveAuthDomain(): string {
  if (typeof window === 'undefined') return FIREBASE_DOMAIN;
  const host = window.location.hostname;
  if (APP_HOSTS.includes(host)) return host;
  // En localhost es lo normal y esperado. En cualquier otro dominio conviene
  // avisar: significa que el iPhone usará el camino frágil.
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.warn(
      `[GEMB] El dominio "${host}" no está en APP_HOSTS (src/lib/firebase.ts). ` +
        'El ingreso con Google puede fallar en iPhone. Ver el paso 4b del README.',
    );
  }
  return FIREBASE_DOMAIN;
}

// Estas llaves NO son secretas: viajan en el bundle del navegador.
// La seguridad real la dan las reglas de Firestore y el login de Google.
const firebaseConfig = {
  apiKey: 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ',
  authDomain: resolveAuthDomain(),
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

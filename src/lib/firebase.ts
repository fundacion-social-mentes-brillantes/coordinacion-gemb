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

// Estas llaves NO son secretas: viajan en el bundle del navegador.
// La seguridad real la dan las reglas de Firestore y el login de Google.
const firebaseConfig = {
  apiKey: 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ',
  authDomain: 'coordinacion-gemb.firebaseapp.com',
  projectId: 'coordinacion-gemb',
  storageBucket: 'coordinacion-gemb.firebasestorage.app',
  messagingSenderId: '1019293780998',
  appId: '1:1019293780998:web:5f6c2d4adb72291cc4c787',
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Sesión persistente: la usuaria NO debe desloguearse sola.
setPersistence(auth, browserLocalPersistence).catch((e) => {
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

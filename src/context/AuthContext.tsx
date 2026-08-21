import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import {
  auth,
  authReady,
  googleProvider,
  db,
  SUPER_ADMIN_EMAIL,
} from '../lib/firebase';
import type { UserProfile, Role } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  /** Hay sesión pero el perfil no llega (red o permisos): hay que dar salida. */
  stuck: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
  isSuperAdmin: boolean;
  isAdmin: boolean; // admin o super_admin
  isCoordinador: boolean; // coordinador, admin o super_admin (puede marcar)
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

/**
 * Marca "salí hacia Google y estoy volviendo".
 *
 * Se guarda en el almacenamiento del navegador (no en memoria) porque en el
 * iPhone la app se cierra al saltar a Google y puede arrancar de cero al
 * volver. Sirve para no dejar a la usuaria mirando otra vez la pantalla de
 * ingreso sin ninguna explicación.
 */
const REDIRECT_FLAG = 'gemb:entrando-con-google';

function markRedirectStarted() {
  try {
    localStorage.setItem(REDIRECT_FLAG, String(Date.now()));
  } catch {
    /* modo privado: no es fatal */
  }
}

function wasRedirectStarted(): boolean {
  try {
    const v = localStorage.getItem(REDIRECT_FLAG);
    if (!v) return false;
    // Solo cuenta si es reciente (10 minutos): una marca vieja no debe
    // provocar mensajes de error en un arranque normal.
    return Date.now() - Number(v) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function clearRedirectFlag() {
  try {
    localStorage.removeItem(REDIRECT_FLAG);
  } catch {
    /* nada */
  }
}

function mapAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  if (code.includes('popup-closed') || code.includes('cancelled-popup'))
    return 'Se cerró la ventana de acceso. Inténtalo de nuevo.';
  if (code.includes('network'))
    return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (code.includes('unauthorized-domain'))
    return 'Este dominio no está autorizado en Firebase (revisa el paso 4 del README).';
  if (code.includes('web-storage-unsupported'))
    return 'Tu navegador está bloqueando el almacenamiento. Si estás en navegación privada, sal de ella e inténtalo de nuevo.';
  if (code.includes('popup-blocked'))
    return 'El navegador bloqueó la ventana de Google. Inténtalo de nuevo.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

/** ¿Es un iPhone/iPad? Ahí la ventana emergente de Google es poco fiable. */
function isAppleMobile(): boolean {
  const ua = navigator.userAgent || '';
  return (
    /iP(hone|ad|od)/.test(ua) ||
    // El iPad moderno se hace pasar por Mac; se delata por el táctil.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Crea (o corrige) el documento del usuario en `users/{uid}`.
 * - El correo super admin siempre queda como `super_admin`.
 * - Si hay una invitación (pre-autorización) para el correo, aplica ese rol.
 * - En cualquier otro caso, se crea como `pending`.
 */
async function ensureUserDoc(u: User) {
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  const email = (u.email || '').trim();
  const emailLower = email.toLowerCase();
  const isSuper = emailLower === SUPER_ADMIN_EMAIL.toLowerCase();

  if (snap.exists()) {
    if (isSuper && snap.data().role !== 'super_admin') {
      await updateDoc(ref, { role: 'super_admin', active: true });
    }
    return;
  }

  const base = {
    email,
    displayName: u.displayName || email,
    photoURL: u.photoURL || '',
    active: true,
    createdAt: serverTimestamp(),
  };

  if (isSuper) {
    await setDoc(ref, { ...base, role: 'super_admin' });
    return;
  }

  // ¿Existe una invitación para este correo?
  let invitedRole: Role | null = null;
  try {
    const inv = await getDoc(doc(db, 'invites', emailLower));
    if (inv.exists()) {
      const r = inv.data().role;
      if (r === 'admin' || r === 'coordinador') invitedRole = r;
    }
  } catch {
    /* sin invitación o sin permiso: se ignora */
  }

  if (invitedRole) {
    try {
      await setDoc(ref, { ...base, role: invitedRole });
      return;
    } catch {
      /* si las reglas rechazan el auto-rol, cae a pendiente */
    }
  }

  await setDoc(ref, { ...base, role: 'pending' });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let alive = true;
    let unsubProfile: (() => void) | null = null;

    // Estado del arranque. La pantalla de ingreso NO debe aparecer mientras
    // todavía se está resolviendo el regreso desde Google: eso es justo lo que
    // en el iPhone se veía como "vuelve a la pantalla de ingreso".
    let redirectSettled = false;
    let signedOutSeen = false;

    const showLoginScreen = () => {
      if (!alive) return;
      if (wasRedirectStarted()) {
        // Volvimos de Google sin sesión: hay que decirlo, no callar.
        // Ojo: la marca se escribe ANTES de saltar a Google, así que esto
        // también ocurre si la usuaria simplemente canceló allí. El mensaje
        // tiene que servir para los dos casos, sin alarmar.
        clearRedirectFlag();
        setAuthError('No se completó el ingreso. Inténtalo de nuevo.');
      }
      setLoading(false);
    };

    // 1) Cierra el viaje de vuelta desde Google (método por redirección).
    void (async () => {
      try {
        await authReady;
        await getRedirectResult(auth);
      } catch (e) {
        clearRedirectFlag();
        if (alive) setAuthError(mapAuthError(e));
      } finally {
        redirectSettled = true;
        // Se comprueba `currentUser` además de la marca: si el regreso SÍ
        // trajo sesión, no hay que mostrar la pantalla de ingreso ni un error.
        if (signedOutSeen && !auth.currentUser) showLoginScreen();
      }
    })();

    // 2) Escucha el estado de la sesión.
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!alive) return;

      // Limpia la suscripción anterior al documento de perfil.
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setUser(u);

      if (!u) {
        setProfile(null);
        setStuck(false);
        signedOutSeen = true;
        // Si el regreso de Google aún no terminó, espera: puede haber sesión.
        if (redirectSettled) showLoginScreen();
        return;
      }

      // Hay sesión: ya no hace falta la marca del viaje.
      clearRedirectFlag();
      signedOutSeen = false;
      setAuthError(null);
      setStuck(false);

      // Escucha en vivo el documento del usuario (el rol puede cambiar).
      // Se suscribe ANTES de crear el documento: así, si la creación tarda o
      // falla, la pantalla no se queda esperando para siempre.
      unsubProfile = onSnapshot(
        doc(db, 'users', u.uid),
        (snap) => {
          if (!alive) return;
          if (snap.exists()) {
            setProfile({
              uid: u.uid,
              ...(snap.data() as Omit<UserProfile, 'uid'>),
            });
            setStuck(false);
          } else {
            setProfile(null);
          }
          setLoading(false);
        },
        (err) => {
          console.warn('Error leyendo el perfil:', err);
          if (!alive) return;
          setStuck(true);
          setLoading(false);
        },
      );

      // Crea/corrige el documento en paralelo.
      void ensureUserDoc(u).catch((e) => {
        console.warn('No se pudo crear/actualizar el perfil:', e);
        if (alive) setStuck(true);
      });
    });

    // 3) Red de seguridad: nunca dejar una ruedita girando para siempre.
    const bailout = window.setTimeout(() => {
      if (!alive) return;
      redirectSettled = true;
      if (auth.currentUser) setStuck(true);
      else showLoginScreen();
      setLoading(false);
    }, 15000);

    return () => {
      alive = false;
      window.clearTimeout(bailout);
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);

    // En iPhone/iPad la ventana emergente de Google es poco fiable (con la app
    // instalada no abre y la promesa se queda colgada en "Conectando…"), así
    // que ahí se usa siempre el método por redirección.
    if (isAppleMobile()) {
      // Espera a que la persistencia esté fijada: si no, la sesión podría
      // guardarse donde no debe y perderse al volver de Google. Aquí sí se
      // puede esperar porque no hay ninguna ventana emergente que abrir.
      await authReady;
      markRedirectStarted();
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (e) {
        clearRedirectFlag();
        setAuthError(mapAuthError(e));
      }
      return;
    }

    // OJO: en el resto de navegadores NO se puede esperar nada antes de abrir
    // la ventana emergente. El navegador solo la deja abrir si es consecuencia
    // directa del toque de la usuaria.
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      // Si el popup no funciona (frecuente en algunos móviles), usa redirect.
      if (
        code.includes('popup-blocked') ||
        code.includes('popup-closed') ||
        code.includes('cancelled-popup') ||
        code.includes('operation-not-supported') ||
        // Navegador que bloquea el almacenamiento de la ventana emergente
        // (Safari y algunos navegadores con el rastreo muy restringido).
        code.includes('web-storage-unsupported') ||
        code.includes('internal-error')
      ) {
        await authReady;
        markRedirectStarted();
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (e2) {
          clearRedirectFlag();
          setAuthError(mapAuthError(e2));
        }
      } else {
        setAuthError(mapAuthError(e));
      }
    }
  }, []);

  const logout = useCallback(async () => {
    clearRedirectFlag();
    setStuck(false);
    await signOut(auth);
  }, []);

  const role = profile?.role;
  const isSuperAdmin = role === 'super_admin';
  const isAdmin = role === 'super_admin' || role === 'admin';
  const isCoordinador =
    role === 'coordinador' || role === 'admin' || role === 'super_admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        stuck,
        signIn,
        logout,
        isSuperAdmin,
        isAdmin,
        isCoordinador,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

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
  clearIndexedDbPersistence,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  terminate,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  waitForPendingWrites,
} from 'firebase/firestore';
import {
  auth,
  authReady,
  authIsFirstParty,
  googleProvider,
  db,
  SUPER_ADMIN_EMAIL,
} from '../lib/firebase';
import { isAppleMobile, isStandalone } from '../lib/device';
import type { UserProfile, Role } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  /** Hay sesión pero el perfil no llega (red o permisos): hay que dar salida. */
  stuck: boolean;
  signIn: () => Promise<void>;
  /** false = la persona decidió no salir (había cambios sin enviar). */
  logout: () => Promise<boolean>;
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
    return isAppleMobile()
      ? 'Safari no dejó abrir la ventana de Google. Vuelve a tocar «Ingresar con Google». Si sigue sin abrir: Ajustes del iPhone → Safari → apaga «Bloquear ventanas emergentes».'
      : 'El navegador bloqueó la ventana de Google. Inténtalo de nuevo.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

/**
 * ¿Es la app instalada del iPhone, que HOY no tiene forma de entrar?
 *
 * Ahí la ventana emergente de Google abre fuera del alcance de la app y la
 * promesa se queda colgada para siempre, y la redirección vuelve sin sesión
 * mientras el ayudante siga en el dominio de Firebase (ver `signIn`). Se
 * exporta para que la pantalla de ingreso lo diga ANTES del toque.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function iosInstaladaSinIngreso(): boolean {
  return isAppleMobile() && isStandalone() && !authIsFirstParty;
}

const IOS_INSTALADA_MSG =
  'En la app instalada del iPhone todavía no se puede entrar con Google. Mientras tanto, entra desde Safari: funciona igual.';

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
      // La invitación ya cumplió: se borra para que no vuelva a dar el rol
      // si algún día se recrea la cuenta (y para que la lista de Usuarios
      // muestre solo las que siguen pendientes).
      await deleteDoc(doc(db, 'invites', emailLower)).catch(() => {});
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
    // ¿Ya se le mostró algo a la usuaria (ingreso o su cuenta)? A partir de
    // ahí la red de seguridad de abajo no tiene nada que rescatar.
    let settled = false;
    const finishLoading = () => {
      settled = true;
      setLoading(false);
    };

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
      finishLoading();
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
            finishLoading();
          } else {
            // Aún no existe (se está creando): se deja ver "Preparando tu
            // cuenta…", pero sin dar el arranque por resuelto, para que la
            // red de seguridad rescate si la creación nunca termina.
            setProfile(null);
            setLoading(false);
          }
        },
        (err) => {
          console.warn('Error leyendo el perfil:', err);
          if (!alive) return;
          setStuck(true);
          finishLoading();
        },
      );

      // Crea/corrige el documento en paralelo.
      void ensureUserDoc(u).catch((e) => {
        console.warn('No se pudo crear/actualizar el perfil:', e);
        if (alive) setStuck(true);
      });
    });

    // 3) Red de seguridad: nunca dejar una ruedita girando para siempre.
    // Solo actúa si el arranque sigue sin resolverse. Antes saltaba siempre a
    // los 15 segundos y marcaba "atascada" a quien ya había cargado su cuenta
    // sin problema (o a quien justo terminaba de entrar por la ventana).
    const bailout = window.setTimeout(() => {
      if (!alive || settled) return;
      redirectSettled = true;
      if (auth.currentUser) setStuck(true);
      else showLoginScreen();
      finishLoading();
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

    const viaRedirect = async () => {
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
    };

    /*
     * POR QUÉ EL IPHONE VA APARTE (y por qué antes no dejaba entrar)
     *
     * La redirección deja el resultado del ingreso guardado en el dominio del
     * ayudante de Google. Mientras ese ayudante viva en el dominio de Firebase
     * (`authIsFirstParty` falso), Safari lo trata como "de un tercero" y le
     * esconde ese guardado a nuestra página: vuelve de Google sin sesión y
     * muestra otra vez la pantalla de ingreso. Pasa en TODOS los navegadores
     * del iPhone, porque todos son Safari por dentro. Antes el iPhone usaba
     * siempre la redirección, así que no había manera de entrar.
     *
     * La ventana emergente no depende de ese guardado y SÍ funciona en Safari,
     * salvo en la app instalada, donde se queda colgada. De ahí las tres
     * salidas de abajo.
     */
    if (isAppleMobile()) {
      if (authIsFirstParty) {
        // Ayudante en nuestro dominio: la redirección funciona en Safari y
        // en la app instalada, y es lo más fiable en el celular.
        await viaRedirect();
        return;
      }
      if (isStandalone()) {
        // App instalada con el ayudante de Firebase: ninguno de los dos
        // métodos puede funcionar. Mejor decirlo que dejarla dando vueltas.
        setAuthError(IOS_INSTALADA_MSG);
        return;
      }
      // Safari normal: ventana emergente, sin plan B. La redirección aquí
      // vuelve sin sesión, así que "reintentar por redirección" solo
      // cambiaría un mensaje claro por un regreso mudo a esta pantalla.
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        const code = (e as { code?: string })?.code || '';
        // Otro toque abrió una ventana nueva: esa manda, esta se ignora.
        if (!code.includes('cancelled-popup')) setAuthError(mapAuthError(e));
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
      // Un segundo toque abrió otra ventana: la nueva sigue su curso. Irse
      // por redirección aquí sacaría a la usuaria de la página a mitad del
      // ingreso que sí está en marcha.
      if (code.includes('cancelled-popup')) return;
      // Si el popup no funciona (frecuente en algunos móviles), usa redirect.
      // OJO: "popup-closed" NO está aquí: es la persona cerrando la ventana
      // para cancelar, y sacarla de la app hacia Google sería ignorarla.
      if (
        code.includes('popup-blocked') ||
        code.includes('operation-not-supported') ||
        // Navegador que bloquea el almacenamiento de la ventana emergente
        // (Safari y algunos navegadores con el rastreo muy restringido).
        code.includes('web-storage-unsupported') ||
        code.includes('internal-error')
      ) {
        await viaRedirect();
      } else {
        setAuthError(mapAuthError(e));
      }
    }
  }, []);

  /**
   * Cierra la sesión. Devuelve false si la persona decidió no salir.
   *
   * Antes de salir espera (un momento) a que se envíen las marcas hechas sin
   * señal: Firestore las guarda por usuaria, así que si se sale con marcas
   * pendientes solo se envían cuando ESA usuaria vuelva a entrar en ESE
   * teléfono (y si mientras tanto alguien finaliza la sesión, se pierden).
   *
   * Si todo se envió, borra además lo guardado en el teléfono (nombres y
   * datos de las personas): un celular prestado no debe quedar con ellos.
   */
  const logout = useCallback(async (): Promise<boolean> => {
    const enviado = await Promise.race([
      waitForPendingWrites(db).then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (
      !enviado &&
      !window.confirm(
        'Hay cambios que todavía no se enviaron (parece que no hay señal).\n\nSi sales ahora, quedan guardados en este teléfono y se enviarán cuando vuelvas a entrar aquí con tu cuenta.\n\n¿Salir de todas formas?',
      )
    ) {
      return false;
    }
    clearRedirectFlag();
    setStuck(false);
    await signOut(auth);
    if (enviado) {
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch (e) {
        console.warn('No se pudo borrar lo guardado en el teléfono', e);
      }
      // Firestore quedó cerrado: se arranca limpio en la pantalla de ingreso.
      window.location.replace('/login');
    }
    return true;
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

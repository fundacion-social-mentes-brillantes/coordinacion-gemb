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
import { auth, googleProvider, db, SUPER_ADMIN_EMAIL } from '../lib/firebase';
import type { UserProfile, Role } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
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

function mapAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  if (code.includes('popup-closed') || code.includes('cancelled-popup'))
    return 'Se cerró la ventana de acceso. Inténtalo de nuevo.';
  if (code.includes('network'))
    return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (code.includes('unauthorized-domain'))
    return 'Este dominio no está autorizado en Firebase (revisa el paso 4 del README).';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
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

  useEffect(() => {
    // Completa el flujo de redirect (móvil) y muestra errores si los hay.
    getRedirectResult(auth).catch((e) => setAuthError(mapAuthError(e)));

    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      // Limpia la suscripción anterior al documento de perfil.
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }
      setUser(u);

      if (!u) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        await ensureUserDoc(u);
      } catch (e) {
        console.warn('No se pudo crear/actualizar el perfil:', e);
      }

      // Escucha en vivo el documento del usuario (el rol puede cambiar).
      unsubProfile = onSnapshot(
        doc(db, 'users', u.uid),
        (snap) => {
          if (snap.exists()) {
            setProfile({ uid: u.uid, ...(snap.data() as Omit<UserProfile, 'uid'>) });
          } else {
            setProfile(null);
          }
          setLoading(false);
        },
        (err) => {
          console.warn('Error leyendo el perfil:', err);
          setLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      const code = (e as { code?: string })?.code || '';
      // Si el popup no funciona (frecuente en algunos móviles), usa redirect.
      if (
        code.includes('popup-blocked') ||
        code.includes('popup-closed') ||
        code.includes('cancelled-popup') ||
        code.includes('operation-not-supported')
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
        } catch (e2) {
          setAuthError(mapAuthError(e2));
        }
      } else {
        setAuthError(mapAuthError(e));
      }
    }
  }, []);

  const logout = useCallback(async () => {
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

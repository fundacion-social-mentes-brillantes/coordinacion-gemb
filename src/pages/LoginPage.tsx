import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { Spinner, FullScreenSpinner } from '../components/Spinner';
import { InstallButton, IosInstallHelp } from '../components/InstallPrompt';
import { AuthStuck } from '../components/AuthStuck';
import { ThemeToggle } from '../components/ThemeToggle';
import { isUpdateReady } from '../lib/swUpdate';
import { useEffect, useState } from 'react';

/**
 * ¿La app se está abriendo DENTRO de otra app (Facebook, Instagram…)?
 * Google bloquea el ingreso en esos navegadores incrustados, así que hay que
 * avisar en vez de dejar a la persona intentándolo sin explicación.
 */
function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok/i.test(ua);
}

export function LoginPage() {
  const { user, profile, loading, signIn, authError, stuck } = useAuth();
  const [busy, setBusy] = useState(false);

  // OJO: los hooks van ANTES de cualquier `return`. Si se ponen después,
  // React se rompe ("Rendered more hooks than during the previous render").

  // El botón de "Ingresar" navega hacia Google y no vuelve a resolver. Si el
  // iPhone/Android restaura esta página desde su caché al volver "atrás", el
  // botón se quedaría muerto en "Conectando…". Esto lo revive.
  useEffect(() => {
    const revive = () => setBusy(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') revive();
    };
    window.addEventListener('pageshow', revive);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', revive);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /**
   * El aviso de "hay versión nueva" vive en la barra de dentro de la app, que
   * solo existe DESPUÉS de entrar. Quien se quede atascado en esta pantalla
   * nunca recibiría un arreglo. Aquí, como nadie está en mitad de una reunión,
   * la versión nueva se aplica sola (una sola vez, para no ciclar).
   */
  useEffect(() => {
    const YA = 'gemb:auto-actualizado';
    const apply = () => {
      try {
        if (sessionStorage.getItem(YA)) return;
        sessionStorage.setItem(YA, '1');
      } catch {
        /* si no hay almacenamiento, se actualiza igual */
      }
      window.dispatchEvent(new CustomEvent('gemb:do-update'));
    };
    if (isUpdateReady()) apply();
    window.addEventListener('gemb:update-ready', apply);
    return () => window.removeEventListener('gemb:update-ready', apply);
  }, []);

  if (loading) return <FullScreenSpinner label="Comprobando tu sesión…" />;
  if (user && stuck && !profile) return <AuthStuck />;
  if (user && !profile)
    return <FullScreenSpinner label="Preparando tu cuenta…" />;
  if (user && profile) {
    if (profile.role === 'pending' || !profile.active)
      return <Navigate to="/pendiente" replace />;
    return <Navigate to="/sesiones" replace />;
  }

  const handleSignIn = async () => {
    setBusy(true);
    await signIn();
    setBusy(false);
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-b from-primary-50 to-surface px-6">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-5 flex justify-center">
          <Logo className="h-20 w-20" />
        </div>
        <h1 className="text-xl font-bold text-primary-800">Asistencia GEMB</h1>
        <p className="mt-1 text-sm text-slate-500">
          Gimnasio Emocional Mentes Brillantes
        </p>
        <p className="mt-6 text-sm text-slate-600">
          Ingresa con tu cuenta de Google para registrar la asistencia de las
          reuniones.
        </p>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="btn-primary btn-lg mt-6"
        >
          {busy ? (
            <Spinner className="h-5 w-5 text-white" />
          ) : (
            <GoogleGlyph />
          )}
          {busy ? 'Conectando…' : 'Ingresar con Google'}
        </button>

        {authError && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {authError}
          </p>
        )}

        {isInAppBrowser() && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-800">
            Estás abriendo la app <strong>dentro de otra aplicación</strong> y
            Google no permite ingresar así. Toca el menú (··· o ⇗) y elige{' '}
            <strong>«Abrir en Safari»</strong> o <strong>«Abrir en Chrome»</strong>.
          </p>
        )}

        <div className="mt-6 space-y-3">
          <InstallButton className="btn-secondary mx-auto min-h-[48px] text-sm" />
          <IosInstallHelp />
        </div>

        <div className="mt-6 flex items-center justify-center gap-3 border-t border-primary-100 pt-5">
          <span className="text-xs text-slate-500">Tema:</span>
          <ThemeToggle />
        </div>
      </div>

      <p className="mt-6 max-w-xs text-center text-xs text-slate-400">
        La primera vez que ingresas, tu acceso queda pendiente hasta que la
        coordinación lo apruebe.
      </p>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.5 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.3-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.5 18.9 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.5 29.1 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5.2 0 9.6-2 12.9-5.2l-6-5.1c-1.9 1.4-4.3 2.3-6.9 2.3-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39 16.2 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.1-2.2 3.9-3.9 5.2l6 5.1C40.9 35.8 43.5 30.4 43.5 24c0-1.2-.1-2.3-.3-3.5z"
      />
    </svg>
  );
}

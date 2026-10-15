import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth, iosInstaladaSinIngreso } from '../context/AuthContext';
import { Logo, Marca } from '../components/Logo';
import { Spinner, FullScreenSpinner } from '../components/Spinner';
import { InstallButton, IosInstallHelp } from '../components/InstallPrompt';
import { AuthStuck } from '../components/AuthStuck';
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
  // A dónde iba antes de que le pidieran entrar (p. ej. el enlace directo a
  // la reunión de hoy). Solo rutas internas de la app.
  const location = useLocation();
  const pedida = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const destino =
    pedida && pedida.startsWith('/') && !pedida.startsWith('//') && pedida !== '/login'
      ? pedida
      : '/sesiones';

  // OJO: los hooks van ANTES de cualquier `return`. Si se ponen después,
  // React se rompe ("Rendered more hooks than during the previous render").

  // Cuando el ingreso va por redirección, el botón navega hacia Google y no
  // vuelve a resolver. Si el celular restaura esta página desde su caché al
  // volver "atrás", el botón se quedaría muerto en "Conectando…". Esto lo
  // revive.
  //
  // Antes también se revivía al volver a estar visible. Con la ventana
  // emergente eso es un error: en el celular la ventana tapa esta página, y al
  // volver el botón se reactivaba con el ingreso todavía a medias.
  useEffect(() => {
    const revive = () => setBusy(false);
    window.addEventListener('pageshow', revive);
    return () => window.removeEventListener('pageshow', revive);
  }, []);

  /**
   * El aviso de "hay versión nueva" vive en la barra de dentro de la app, que
   * solo existe DESPUÉS de entrar. Quien se quede atascado en esta pantalla
   * nunca recibiría un arreglo. Aquí, como nadie está en mitad de una reunión,
   * la versión nueva se aplica sola (una sola vez, para no ciclar).
   *
   * Pero solo con la pantalla QUIETA. Actualizar es recargar, y recargar
   * mientras se resuelve el regreso desde Google, o con la ventana de Google
   * abierta, tira ese ingreso: la persona tendría que volver a empezar sin
   * saber por qué.
   */
  const quieta = !loading && !user && !busy;
  useEffect(() => {
    if (!quieta) return;
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
  }, [quieta]);

  if (loading) return <FullScreenSpinner label="Comprobando tu sesión…" />;
  if (user && stuck && !profile) return <AuthStuck />;
  if (user && !profile)
    return <FullScreenSpinner label="Preparando tu cuenta…" />;
  if (user && profile) {
    if (profile.role === 'pending' || !profile.active)
      return <Navigate to="/pendiente" replace />;
    return <Navigate to={destino} replace />;
  }

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } finally {
      setBusy(false);
    }
  };

  const sinIngresoAqui = iosInstaladaSinIngreso();

  return (
    <div className="safe-top safe-bottom relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
      <Aurora />
      <div className="entrar relative flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative mb-7">
          <span className="absolute inset-0 -z-10 scale-125 rounded-full bg-[radial-gradient(circle,rgba(47,107,255,0.45),transparent_65%)] blur-2xl" />
          <Logo className="h-24 w-24" />
        </div>
        <Marca tamano="lg" />
        <div className="regla-oro mt-6 w-40" />
        <p className="mt-5 text-[15px] leading-relaxed text-slate-600">
          Asistencia y calendario de las reuniones del
          <br />
          Gimnasio Emocional Mentes Brillantes.
        </p>

        {sinIngresoAqui ? (
          <AbrirEnSafari />
        ) : (
          <button
            type="button"
            onClick={handleSignIn}
            disabled={busy}
            className="boton-google mt-8"
          >
            {busy ? <Spinner className="h-5 w-5 !text-slate-500" /> : <GoogleGlyph />}
            {busy ? 'Conectando…' : 'Continuar con Google'}
          </button>
        )}

        {authError && !sinIngresoAqui && (
          <p className="mt-4 w-full rounded-2xl border border-rose-300/40 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {authError}
          </p>
        )}

        {isInAppBrowser() && (
          <p className="mt-4 w-full rounded-2xl border border-amber-300/40 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
            Estás abriendo la app <strong>dentro de otra aplicación</strong> y
            Google no permite ingresar así. Toca el menú (··· o ⇗) y elige{' '}
            <strong>«Abrir en Safari»</strong> o <strong>«Abrir en Chrome»</strong>.
          </p>
        )}

        <p className="mt-6 max-w-xs text-xs leading-relaxed text-slate-500">
          Si eres del equipo, entras directo. Si es tu primera vez, tu solicitud
          le llega a la coordinación y se abre sola cuando te aprueben.
        </p>

        <div className="mt-6 w-full space-y-3">
          <InstallButton className="btn-secondary mx-auto min-h-[48px] w-full text-sm" />
          <IosInstallHelp />
        </div>

        <Link to="/calendario" className="btn-ghost mt-4 min-h-[44px] text-sm">
          Ver el calendario sin entrar →
        </Link>
      </div>
    </div>
  );
}

/** Dos luces que respiran detrás (azul y oro), como en el ícono. */
function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <span className="aurora-luz left-[-20%] top-[-10%] h-[55vmax] w-[55vmax] bg-[rgb(var(--app-glow-2)/0.35)]" />
      <span
        className="aurora-luz bottom-[-25%] right-[-25%] h-[50vmax] w-[50vmax] bg-[rgb(var(--app-glow-1)/0.18)]"
        style={{ animationDelay: '-6s' }}
      />
    </div>
  );
}

/**
 * Lo que ve la app instalada del iPhone mientras no pueda entrar (ver
 * `iosInstaladaSinIngreso`). En vez de un botón que no funciona, la salida
 * que sí funciona: la misma app en Safari.
 */
function AbrirEnSafari() {
  const [copiado, setCopiado] = useState(false);
  const direccion = window.location.host;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`https://${direccion}`);
      setCopiado(true);
    } catch {
      /* sin portapapeles: la dirección está escrita justo al lado */
    }
  };

  return (
    <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
      <p className="font-semibold">
        En la app instalada del iPhone todavía no se puede entrar
      </p>
      <p className="mt-1">
        Apple bloquea aquí el ingreso con Google. Mientras tanto, entra desde{' '}
        <strong>Safari</strong>: es la misma app y funciona igual.
      </p>
      {/* `x-safari-https://` le pide al iPhone abrir el enlace en Safari y no
          dentro de esta app (iOS 17 o más nuevo). */}
      <a
        href={`x-safari-https://${direccion}/login`}
        className="btn-primary btn-lg mt-3"
      >
        Abrir en Safari
      </a>
      <p className="mt-3">
        Si el botón no abre nada, abre Safari y escribe{' '}
        <strong className="select-all">{direccion}</strong>
      </p>
      <button
        type="button"
        onClick={copiar}
        className="btn-secondary mt-2 min-h-[44px] w-full text-sm"
      >
        {copiado ? 'Dirección copiada ✓' : 'Copiar la dirección'}
      </button>
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

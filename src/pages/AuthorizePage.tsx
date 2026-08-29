import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/Spinner';
import { ROLE_LABELS } from '../lib/constants';
import { redirectPermitido } from '../lib/oauthRedirect';

/**
 * "Entrar con Google" para conectar Claude.
 *
 * Aquí llega la persona cuando toca "Conectar" en Claude. Si no tiene sesión,
 * entra con Google como siempre; si ya la tiene, solo confirma. Al aceptar, se
 * devuelve a Claude un código de un solo uso con el permiso de ESA persona:
 * su rol —y por tanto qué podrá hacer Claude— viene dado, sin configurar nada.
 */
export function AuthorizePage() {
  const { user, profile, loading, signIn } = useAuth();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const { redirectUri, state, reto, destinoAjeno } = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const pedido = p.get('redirect_uri') ?? '';
    // Aquí se puede llegar por un enlace suelto, sin pasar por /api/oauth. Por
    // eso se vuelve a comprobar: al aceptar se entrega la llave de sesión de
    // quien acepta, y solo puede acabar en Claude.
    const permitido = pedido !== '' && redirectPermitido(pedido);
    return {
      redirectUri: permitido ? pedido : '',
      state: p.get('state') ?? '',
      reto: p.get('code_challenge') ?? '',
      destinoAjeno: pedido !== '' && !permitido,
    };
  }, []);

  useEffect(() => {
    document.title = 'Conectar con Claude';
  }, []);

  const esAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const aceptar = () => {
    const llave = user?.refreshToken;
    // `redirectUri` ya viene filtrado, pero se comprueba otra vez justo antes
    // de entregar: es la última línea antes de que la llave salga de aquí.
    if (!llave || !redirectUri || !redirectPermitido(redirectUri)) {
      setError('Falta información para completar la conexión. Vuelve a intentarlo desde Claude.');
      return;
    }
    setEnviando(true);
    // El código dura 5 minutos y solo sirve una vez, en la conversación que
    // lo pidió: Claude lo cambia enseguida por el permiso de consulta.
    const codigo = btoa(
      JSON.stringify({ llave, reto: reto || undefined, exp: Date.now() + 5 * 60_000 }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const destino = new URL(redirectUri);
    destino.searchParams.set('code', codigo);
    if (state) destino.searchParams.set('state', state);
    window.location.replace(destino.toString());
  };

  // Alguien intentó que esto devolviera la llave a un sitio que no es Claude.
  // Se corta aquí y se dice claro, porque quien lo ve probablemente llegó por
  // un enlace que le pasaron.
  if (destinoAjeno) {
    return (
      <Marco>
        <p className="text-sm font-semibold text-red-700">Conexión bloqueada</p>
        <p className="mt-2 text-sm text-slate-600">
          Este enlace pedía devolver tu acceso a un sitio que no es Claude, así
          que no se ha entregado nada. Si te lo mandó alguien, bórralo.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Para conectar de verdad, hazlo desde Claude: él abre esta pantalla solo.
        </p>
      </Marco>
    );
  }

  if (!redirectUri) {
    return (
      <Marco>
        <p className="text-sm text-slate-600">
          Esta pantalla se abre desde Claude, al conectar el conector de
          Coordinación. No hace falta entrar aquí por tu cuenta.
        </p>
      </Marco>
    );
  }

  if (loading) {
    return (
      <Marco>
        <div className="flex justify-center py-6">
          <Spinner className="h-8 w-8" />
        </div>
      </Marco>
    );
  }

  // Sin sesión: entrar con Google, como en el resto de la app.
  if (!user) {
    return (
      <Marco>
        <p className="text-sm text-slate-600">
          Entra con tu cuenta de Google —la misma de siempre— para que Claude
          pueda consultar la asistencia en tu nombre.
        </p>
        <button
          type="button"
          onClick={() => signIn().catch((e) => setError(String(e)))}
          className="btn-primary mt-4 min-h-[52px] w-full"
        >
          Entrar con Google
        </button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Marco>
    );
  }

  if (!profile || profile.role === 'pending' || !profile.active) {
    return (
      <Marco>
        <p className="text-sm text-slate-600">
          Tu cuenta <strong>{user.email}</strong> todavía no está aprobada en la
          app, así que no se puede conectar. Pídele a la administración que te
          apruebe y vuelve a intentarlo.
        </p>
      </Marco>
    );
  }

  return (
    <Marco>
      <p className="text-sm text-slate-600">
        Vas a permitir que Claude consulte la asistencia como:
      </p>
      <p className="mt-2 font-semibold text-primary-800">{profile.displayName || user.email}</p>
      <p className="text-xs text-slate-500">{ROLE_LABELS[profile.role]}</p>

      <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50/50 p-3 text-left">
        {esAdmin ? (
          <>
            <p className="text-sm font-semibold text-primary-800">Lectura y escritura</p>
            <p className="mt-1 text-xs text-slate-600">
              Podrá consultar todo lo que tú ves y además registrar y corregir
              (crear reuniones, marcar asistencia, aprobar personas). Cada
              cambio te lo mostrará como borrador antes de guardarlo.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-primary-800">Solo lectura</p>
            <p className="mt-1 text-xs text-slate-600">
              Podrá consultar las reuniones y cómo va el grupo. No podrá cambiar
              nada.
            </p>
          </>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Nunca verá teléfonos ni las notas privadas de las fichas.
        </p>
      </div>

      <button
        type="button"
        onClick={aceptar}
        disabled={enviando}
        className="btn-primary mt-4 min-h-[52px] w-full"
      >
        {enviando ? 'Conectando…' : 'Permitir'}
      </button>
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mt-2 min-h-[44px] w-full text-sm font-medium text-slate-500"
      >
        Cancelar
      </button>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <p className="mt-4 text-[11px] leading-snug text-slate-400">
        Puedes retirar el permiso cuando quieras: sal de la app con el botón de
        salir, o pide que desactiven tu cuenta en Usuarios.
      </p>
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-top safe-bottom flex min-h-[100dvh] items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6 text-center">
        <Logo className="mx-auto h-14 w-14" />
        <h1 className="mt-3 text-lg font-bold text-primary-900">Conectar con Claude</h1>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

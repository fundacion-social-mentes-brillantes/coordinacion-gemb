import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { EliminarCuenta, ponerMarcaEliminar } from '../components/EliminarCuenta';

const CORREO = 'fundacionsocial@gimnasioemocionalmb.com';
const ACTUALIZADA = '15 de octubre de 2026';

/**
 * Páginas públicas que exige Google Play: la política de privacidad y cómo
 * eliminar la cuenta. Se ven sin entrar (las revisa Google y cualquiera que
 * quiera saber qué se guarda).
 */
function PaginaLegal({ titulo, children }: { titulo: string; children: ReactNode }) {
  const { user } = useAuth();
  useEffect(() => {
    document.title = `${titulo} — Coordinación GEMB`;
    return () => {
      document.title = 'Coordinación GEMB';
    };
  }, [titulo]);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-[color:var(--app-border)] bg-surface/70 backdrop-blur-xl">
        <div
          className="flex items-center gap-2 py-2"
          style={{
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
          }}
        >
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-primary-800">Coordinación GEMB</p>
            <p className="truncate text-[11px] leading-tight text-slate-500">
              Gimnasio Emocional Mentes Brillantes
            </p>
          </div>
          <Link to={user ? '/ajustes' : '/login'} className="btn-secondary min-h-[40px] shrink-0 px-3 text-sm">
            {user ? 'Volver' : 'Entrar'}
          </Link>
        </div>
      </header>
      <main className="safe-bottom flex-1 px-4 py-6">
        <h1 className="titulo-pantalla">{titulo}</h1>
        <p className="mt-1 text-xs text-slate-500">Última actualización: {ACTUALIZADA}</p>
        <div className="mt-5 space-y-4">{children}</div>
      </main>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="card space-y-2 p-4 text-sm leading-relaxed text-slate-600">
      <h2 className="text-base font-bold text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

const Correo = () => (
  <a href={`mailto:${CORREO}`} className="font-semibold text-primary-500 underline-offset-2 hover:underline">
    {CORREO}
  </a>
);

export function PrivacidadPage() {
  return (
    <PaginaLegal titulo="Política de privacidad">
      <Bloque titulo="Quién es responsable">
        <p>
          Coordinación GEMB es la app del <strong>Gimnasio Emocional Mentes Brillantes</strong>. La
          usa el equipo para llevar la asistencia, el calendario y los recursos de sus reuniones.
          Para cualquier pregunta sobre tus datos escríbenos a <Correo />.
        </p>
      </Bloque>

      <Bloque titulo="Qué datos guardamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>De quien usa la app (el equipo):</strong> nombre, correo y foto de su cuenta de
            Google, su rol y la fecha en que entró por primera vez.
          </li>
          <li>
            <strong>De quienes asisten a las reuniones:</strong> nombre y apodos; si la
            coordinación lo anota, teléfono y notas; y la asistencia a cada reunión (fecha, reunión
            y quién la registró).
          </li>
          <li>
            <strong>Del calendario:</strong> quién coordina cada reunión.
          </li>
        </ul>
        <p>
          No pedimos ubicación, contactos, fotos, cámara ni micrófono. La app no tiene anuncios ni
          herramientas de analítica o rastreo.
        </p>
      </Bloque>

      <Bloque titulo="Para qué los usamos">
        <p>
          Solo para organizar las reuniones: tomar asistencia, saber quién coordina cada fecha,
          consultar la carpeta y compartir los enlaces de Meet, y llevar las cifras internas de la
          fundación. No vendemos ni cedemos datos a nadie.
        </p>
      </Bloque>

      <Bloque titulo="Quién puede verlos">
        <p>
          Solo las personas del equipo que la administración aprueba. Quien entra con Google sin
          estar aprobado no ve ningún dato. El calendario público muestra únicamente las fechas de
          las reuniones y el nombre de quien coordina cada una.
        </p>
      </Bloque>

      <Bloque titulo="Dónde se guardan">
        <p>
          En Google Firebase (Google Cloud), siempre con conexión cifrada. La página se sirve
          desde Vercel. El teléfono guarda una copia para funcionar sin señal, y se borra al
          cerrar sesión.
        </p>
      </Bloque>

      <Bloque titulo="Conexión con Claude (opcional)">
        <p>
          Si una persona del equipo lo activa en <em>Ajustes → Conectar con Claude</em>, el
          asistente Claude (de Anthropic) puede consultar la asistencia para responderle a ella,
          con sus mismos permisos. Se puede desconectar en cualquier momento.
        </p>
      </Bloque>

      <Bloque titulo="App de Android">
        <p>
          Pide permiso de notificaciones solo para mostrar la burbuja flotante encima de Meet.
        </p>
      </Bloque>

      <Bloque titulo="Cuánto tiempo los guardamos">
        <p>
          La cuenta del equipo, mientras la persona sea del equipo o hasta que la elimine. La
          asistencia y el calendario se conservan como registro histórico de la fundación.
        </p>
      </Bloque>

      <Bloque titulo="Tus derechos">
        <p>
          Según la Ley 1581 de 2012 de Colombia, puedes conocer, actualizar y corregir tus datos,
          pedir que los borremos y revocar tu autorización. Escríbenos a <Correo />. Para borrar tu
          cuenta del equipo, mira{' '}
          <Link to="/eliminar-cuenta" className="font-semibold text-primary-500 underline-offset-2 hover:underline">
            cómo eliminar tu cuenta
          </Link>
          .
        </p>
      </Bloque>

      <Bloque titulo="Menores de edad">
        <p>La app es para las personas adultas del equipo.</p>
      </Bloque>

      <Bloque titulo="Cambios">
        <p>Si cambiamos esta política, lo verás en la fecha de arriba.</p>
      </Bloque>
    </PaginaLegal>
  );
}

export function EliminarCuentaPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const entrarParaEliminar = () => {
    ponerMarcaEliminar();
    navigate('/login');
  };

  return (
    <PaginaLegal titulo="Eliminar tu cuenta">
      <Bloque titulo="Desde la app">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Entra a Coordinación GEMB con tu cuenta de Google.</li>
          <li>
            Toca la rueda de <strong>Ajustes</strong> (arriba) y luego{' '}
            <strong>Eliminar mi cuenta</strong>. Si todavía no te han dado acceso, el botón está en
            la pantalla de espera.
          </li>
          <li>
            Confirma con <strong>Sí, eliminar mi cuenta</strong>.
          </li>
        </ol>
        <div className="pt-2">
          {user ? (
            <EliminarCuenta className="btn-secondary !text-rose-600" />
          ) : (
            <button type="button" onClick={entrarParaEliminar} className="btn-secondary min-h-[48px] w-full">
              Entrar para eliminar mi cuenta
            </button>
          )}
        </div>
      </Bloque>

      <Bloque titulo="Sin entrar a la app">
        <p>
          Escribe a <Correo /> desde el correo de tu cuenta, con el asunto «Eliminar mi cuenta».
          La borramos en un máximo de 15 días hábiles y te avisamos.
        </p>
      </Bloque>

      <Bloque titulo="Qué se borra y qué se conserva">
        <p>
          <strong>Se borra:</strong> tu nombre, tu correo y tu foto de Google, tu rol y tu acceso a
          la app.
        </p>
        <p>
          <strong>Se conserva:</strong> las asistencias que registraste y el calendario de
          reuniones, como registro histórico de la fundación. En ellos aparece tu nombre como quien
          tomó la asistencia o coordinó.
        </p>
        <p>
          Si asistes a las reuniones y quieres que borremos tus datos de la lista, escríbenos al
          mismo correo.
        </p>
      </Bloque>
    </PaginaLegal>
  );
}

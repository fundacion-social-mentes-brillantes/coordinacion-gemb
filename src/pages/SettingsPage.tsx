import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../lib/constants';
import {
  InstallButton,
  IosInstallHelp,
  usePuedeInstalar,
  useNecesitaAyudaIos,
} from '../components/InstallPrompt';
import { ChevronRightIcon, RobotIcon } from '../components/Icons';

/**
 * Ajustes: el cajón de lo que casi nunca se toca.
 *
 * Existe para sacar de en medio cosas que estorbaban en las pantallas de
 * trabajo. Conectar con Claude es de esas: se hace UNA vez y no se vuelve a
 * mirar, pero estaba en Sesiones —la pantalla que las coordinadoras abren
 * cada semana— compitiendo con "Nueva sesión".
 *
 * Se llega desde la rueda dentada de la cabecera. A propósito no está en la
 * barra de abajo: eso es para lo de todos los días.
 */
export function SettingsPage() {
  const { profile, user } = useAuth();
  // Los dos componentes de instalación se pintan solos o no según el
  // dispositivo. Hay que preguntarlo antes para no dejar el título encima
  // de un hueco vacío, que es como se veía en el computador.
  const [puedeInstalar] = usePuedeInstalar();
  const necesitaAyudaIos = useNecesitaAyudaIos();
  const hayAlgoQueInstalar = puedeInstalar !== null || necesitaAyudaIos;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-primary-900">Ajustes</h2>

      {/* Quién eres. Resuelve el "¿con qué cuenta entré?" sin buscar. */}
      <div className="card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Tu cuenta</p>
        <p className="mt-1 font-semibold text-primary-800">
          {profile?.displayName || profile?.email || user?.email}
        </p>
        <p className="text-sm text-slate-500">
          {profile ? ROLE_LABELS[profile.role] : ''}
        </p>
      </div>

      {/* Conectar con Claude. */}
      <div>
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          Avanzado
        </p>
        <Link
          to="/conectar"
          className="card mt-2 flex items-center gap-3 p-4 text-left active:bg-slate-50"
        >
          <RobotIcon className="shrink-0 text-2xl text-primary-500" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-slate-800">Conectar con Claude</span>
            <span className="block text-sm text-slate-500">
              Para preguntarle por la asistencia sin entrar a la app.
            </span>
          </span>
          <ChevronRightIcon className="shrink-0 text-xl text-slate-300" />
        </Link>
      </div>

      {/* Instalar la app en el teléfono. Solo si de verdad hay algo que ofrecer. */}
      {hayAlgoQueInstalar && (
        <div>
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            La app en tu teléfono
          </p>
          <div className="mt-2 space-y-2">
            <InstallButton className="btn-secondary min-h-[48px] w-full text-sm" />
            <IosInstallHelp />
          </div>
        </div>
      )}
    </div>
  );
}

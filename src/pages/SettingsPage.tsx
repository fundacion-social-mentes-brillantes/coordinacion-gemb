import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { nombreDeRol } from '../lib/constants';
import {
  InstallButton,
  IosInstallHelp,
  usePuedeInstalar,
  useNecesitaAyudaIos,
} from '../components/InstallPrompt';
import { ColoresEditor } from '../components/ColoresEditor';
import { ChevronRightIcon, RobotIcon } from '../components/Icons';
import { EliminarCuenta } from '../components/EliminarCuenta';

/**
 * Ajustes: el cajón de lo que casi nunca se toca (cuenta, colores, conectar
 * con Claude, instalar la app). Se llega desde la rueda dentada de arriba; a
 * propósito no está en la barra de abajo, que es para lo de todos los días.
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
    <div className="space-y-6">
      <h2 className="titulo-pantalla">Ajustes</h2>

      {/* Quién eres. Resuelve el "¿con qué cuenta entré?" sin buscar. */}
      <section className="card p-4">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tu cuenta</p>
        <p className="mt-1 text-lg font-bold text-slate-900">
          {profile?.displayName || profile?.email || user?.email}
        </p>
        <p className="text-sm text-slate-500">{user?.email}</p>
        <p className="mt-2 inline-flex rounded-full bg-primary-500/15 px-3 py-1 text-xs font-bold text-primary-500">
          {nombreDeRol(profile)}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">Colores</h3>
        <ColoresEditor />
      </section>

      {/* Instalar la app en el teléfono. Solo si de verdad hay algo que ofrecer. */}
      {hayAlgoQueInstalar && (
        <section className="space-y-2">
          <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">
            La app en tu teléfono
          </h3>
          <InstallButton className="btn-secondary min-h-[48px] w-full text-sm" />
          <IosInstallHelp />
        </section>
      )}

      {/* Conectar con Claude. */}
      <section className="space-y-2">
        <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">Avanzado</h3>
        <Link to="/conectar" className="card flex items-center gap-3 p-4 text-left">
          <RobotIcon className="shrink-0 text-2xl text-primary-500" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-slate-800">Conectar con Claude</span>
            <span className="block text-sm text-slate-500">
              Para preguntarle por la asistencia sin entrar a la app.
            </span>
          </span>
          <ChevronRightIcon className="shrink-0 text-xl text-slate-400" />
        </Link>
      </section>

      {/* Privacidad y borrar la cuenta (lo exige Google Play). */}
      <section className="space-y-1 text-center">
        <Link to="/privacidad" className="btn-ghost min-h-[44px] w-full text-sm">
          Política de privacidad
        </Link>
        <EliminarCuenta />
      </section>
    </div>
  );
}

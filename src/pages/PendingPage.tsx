import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo, Marca } from '../components/Logo';
import { FullScreenSpinner } from '../components/Spinner';
import { inicioDeLaVentana } from '../lib/nativo';
import { EliminarCuenta } from '../components/EliminarCuenta';

/**
 * Entró con Google pero todavía no tiene acceso. La solicitud ya le aparece
 * a la coordinación en Usuarios; en cuanto le den acceso, esta pantalla se
 * abre sola (el perfil se escucha en vivo).
 */
export function PendingPage() {
  const { user, profile, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && profile.role !== 'pending' && profile.active) {
    return <Navigate to={inicioDeLaVentana()} replace />;
  }

  const deactivated = profile && profile.role !== 'pending' && !profile.active;

  const handleLogout = async () => {
    if (!(await logout())) return;
    navigate('/login', { replace: true });
  };

  return (
    <div className="safe-top safe-bottom flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="entrar flex w-full max-w-sm flex-col items-center">
        {/* El ícono con la luz que gira: "estamos esperando". */}
        <div className="arranque-icono mb-6">
          {!deactivated && <span className="arranque-orbita" />}
          <Logo className="h-[84px] w-[84px]" />
        </div>
        <Marca tamano="sm" />

        <div className="card mt-8 w-full p-6">
          {deactivated ? (
            <>
              <h1 className="text-xl font-bold text-slate-900">Tu acceso está pausado</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Habla con la coordinación para que te lo devuelvan.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-slate-900">¡Ya casi!</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Tu solicitud le llegó a la coordinación. <strong>No cierres la app:</strong> en
                cuanto te den acceso, esta pantalla se abre sola.
              </p>
            </>
          )}
          <p className="mt-4 rounded-2xl bg-white/5 px-3 py-2 text-xs text-slate-500">
            Entraste como <strong className="text-slate-700">{profile?.email ?? user.email}</strong>
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-secondary mt-5 min-h-[48px] w-full"
          >
            Volver a comprobar
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-ghost mt-1 min-h-[44px] w-full text-sm"
          >
            Entrar con otra cuenta
          </button>
          <EliminarCuenta />
        </div>
      </div>
    </div>
  );
}

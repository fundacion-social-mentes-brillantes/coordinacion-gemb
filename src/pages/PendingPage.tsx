import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { FullScreenSpinner } from '../components/Spinner';

export function PendingPage() {
  const { user, profile, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (profile && profile.role !== 'pending' && profile.active) {
    return <Navigate to="/sesiones" replace />;
  }

  const deactivated = profile && profile.role !== 'pending' && !profile.active;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-6 text-center">
      <div className="card w-full max-w-sm p-8">
        <div className="mx-auto mb-5 flex justify-center">
          <Logo className="h-16 w-16" />
        </div>
        {deactivated ? (
          <>
            <h1 className="text-lg font-bold text-primary-800">
              Tu cuenta está desactivada
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Contacta a la coordinación para reactivar tu acceso.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-primary-800">
              Tu acceso está pendiente de aprobación
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Ya registramos tu ingreso. Una persona de la coordinación debe
              aprobarte y asignarte un rol. Vuelve a intentarlo más tarde.
            </p>
          </>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Ingresaste como <strong>{profile?.email}</strong>
        </p>

        <button
          type="button"
          onClick={handleLogout}
          className="btn-secondary mt-6 w-full"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

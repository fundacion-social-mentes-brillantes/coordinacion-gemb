import { useAuth } from '../context/AuthContext';
import { Logo } from './Logo';

/**
 * Pantalla de rescate: hay sesión de Google, pero el perfil de la app no
 * llega (sin internet, permisos, o el almacenamiento del navegador bloqueado).
 *
 * Antes esto dejaba una ruedita girando para siempre. Ahora se explica qué
 * pasa y se ofrecen dos salidas claras.
 */
export function AuthStuck() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    window.location.replace('/login');
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-6 text-center">
      <div className="card w-full max-w-sm p-8">
        <div className="mx-auto mb-5 flex justify-center">
          <Logo className="h-16 w-16" />
        </div>
        <h1 className="text-lg font-bold text-primary-800">
          No pudimos cargar tu cuenta
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Entraste con Google, pero la app no logró leer tu perfil. Casi siempre
          es la conexión. Revisa tu internet y vuelve a intentarlo.
        </p>
        {user?.email && (
          <p className="mt-4 text-xs text-slate-500">
            Sesión de <strong>{user.email}</strong>
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary btn-lg mt-6"
        >
          Volver a intentar
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="btn-secondary mx-auto mt-3 min-h-[48px] text-sm"
        >
          Salir e ingresar de nuevo
        </button>
      </div>
    </div>
  );
}

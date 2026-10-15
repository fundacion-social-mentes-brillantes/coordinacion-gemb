import { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/Spinner';
import { ProgramacionView } from './ProgramacionPage';

/**
 * El calendario público (/calendario): lo que antes era la página del
 * Calendario de Mentes Brillantes. Cualquiera lo ve sin iniciar sesión y
 * puede "Apartar" una fecha libre. Si quien entra ya tiene cuenta activa, se
 * le lleva al mismo calendario dentro de la app.
 */
export function CalendarioPublicoPage() {
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    document.title = 'Calendario — Mentes Brillantes';
    return () => {
      document.title = 'Coordinación GEMB';
    };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (user && profile?.active && profile.role !== 'pending') {
    return <Navigate to="/programacion" replace />;
  }

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
            <p className="truncate text-sm font-bold leading-tight text-primary-800">Calendario</p>
            <p className="truncate text-[11px] leading-tight text-slate-500">
              Gimnasio Emocional Mentes Brillantes
            </p>
          </div>
          <Link
            to="/login"
            state={{ from: { pathname: '/programacion' } }}
            className="btn-secondary min-h-[40px] shrink-0 px-3 text-sm"
          >
            Entrar
          </Link>
        </div>
      </header>
      <main className="safe-x safe-bottom flex-1 pb-6 pt-4">
        <ProgramacionView publico />
      </main>
    </div>
  );
}

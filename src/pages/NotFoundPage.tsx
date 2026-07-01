import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-6 text-center">
      <Logo className="h-16 w-16" />
      <h1 className="mt-6 text-2xl font-bold text-primary-800">
        Página no encontrada
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        La dirección que buscas no existe.
      </p>
      <Link to="/sesiones" className="btn-primary mt-6">
        Ir al inicio
      </Link>
    </div>
  );
}

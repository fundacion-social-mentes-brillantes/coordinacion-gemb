import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullScreenSpinner } from './Spinner';
import type { Role } from '../types';

/**
 * Protege rutas. Redirige a:
 * - /login si no hay sesión
 * - /pendiente si el rol es `pending` o la cuenta está desactivada
 * - /sesiones si el rol no está permitido para esa ruta
 */
export function RequireAuth({ allow }: { allow: Role[] }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!profile) return <FullScreenSpinner label="Preparando tu cuenta…" />;

  if (profile.role === 'pending' || !profile.active) {
    return <Navigate to="/pendiente" replace />;
  }
  if (!allow.includes(profile.role)) {
    return <Navigate to="/sesiones" replace />;
  }
  return <Outlet />;
}

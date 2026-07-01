import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Logo } from './Logo';
import { InstallButton } from './InstallPrompt';
import {
  CalendarIcon,
  ChartIcon,
  UsersIcon,
  ShieldIcon,
  LogoutIcon,
  WifiOffIcon,
} from './Icons';
import type { Role } from '../types';
import type { ComponentType, SVGProps } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  roles: Role[];
}

const ALL: Role[] = ['coordinador', 'admin', 'super_admin'];
const ADMIN: Role[] = ['admin', 'super_admin'];

const NAV: NavItem[] = [
  { to: '/sesiones', label: 'Sesiones', icon: CalendarIcon, roles: ALL },
  { to: '/panel', label: 'Panel', icon: ChartIcon, roles: ALL },
  { to: '/personas', label: 'Personas', icon: UsersIcon, roles: ADMIN },
  { to: '/usuarios', label: 'Usuarios', icon: ShieldIcon, roles: ADMIN },
];

export function Layout() {
  const { profile, logout } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();

  const role = profile?.role ?? 'coordinador';
  const items = NAV.filter((n) => n.roles.includes(role));

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col bg-surface">
      {/* Cabecera */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-primary-100 bg-white/90 px-4 py-3 backdrop-blur">
        <Logo className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight text-primary-800">
            Asistencia GEMB
          </h1>
          <p className="truncate text-xs text-slate-500">
            {profile?.displayName || profile?.email}
          </p>
        </div>
        {!online && (
          <span className="chip bg-amber-100 text-amber-700">
            <WifiOffIcon className="text-sm" /> Sin conexión
          </span>
        )}
        <InstallButton className="btn-ghost hidden text-sm sm:inline-flex" />
        <button
          type="button"
          onClick={handleLogout}
          className="btn-ghost px-2 py-2"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <LogoutIcon className="text-xl" />
        </button>
      </header>

      {/* Contenido */}
      <main className="flex-1 px-4 pb-28 pt-4">
        <Outlet />
      </main>

      {/* Navegación inferior (móvil) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl border-t border-primary-100 bg-white/95 backdrop-blur">
        <div
          className="flex items-stretch justify-around"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-0.5 px-2 py-2.5 text-[11px] font-medium transition ${
                    isActive
                      ? 'text-primary-600'
                      : 'text-slate-400 hover:text-primary-500'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`text-2xl ${isActive ? 'scale-105' : ''}`}
                    />
                    {item.label}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

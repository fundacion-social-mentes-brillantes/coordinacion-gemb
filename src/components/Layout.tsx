import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { isUpdateReady } from '../lib/swUpdate';
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
  // El panel y la administración son solo para admin/super_admin.
  // Las coordinadoras solo ven "Sesiones".
  { to: '/panel', label: 'Panel', icon: ChartIcon, roles: ADMIN },
  { to: '/personas', label: 'Personas', icon: UsersIcon, roles: ADMIN },
  { to: '/usuarios', label: 'Usuarios', icon: ShieldIcon, roles: ADMIN },
];

export function Layout() {
  const { profile, logout } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement>(null);
  // Aviso de versión nueva (el service worker ya no recarga solo). El estado
  // inicial se lee de la marca porque el aviso del SW llega antes de que esta
  // pantalla exista.
  const [updateReady, setUpdateReady] = useState(isUpdateReady);
  useEffect(() => {
    if (isUpdateReady()) setUpdateReady(true);
    const onReady = () => setUpdateReady(true);
    window.addEventListener('gemb:update-ready', onReady);
    return () => window.removeEventListener('gemb:update-ready', onReady);
  }, []);

  const role = profile?.role ?? 'coordinador';
  const items = NAV.filter((n) => n.roles.includes(role));

  /**
   * Publica la altura real de la cabecera en --header-h para que los
   * buscadores pegajosos se coloquen justo debajo. En el iPhone la cabecera
   * crece con el notch, así que no sirve un número fijo.
   */
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        '--header-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleLogout = async () => {
    if (!window.confirm('¿Cerrar tu sesión en la app?')) return;
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
      {/* Cabecera */}
      <header
        ref={headerRef}
        className="safe-top sticky top-0 z-40 border-b border-primary-100 bg-white/90 backdrop-blur"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-primary-800">
              {profile?.displayName || profile?.email}
            </p>
            <p className="truncate text-[11px] leading-tight text-slate-500">
              {role === 'coordinador' ? 'Coordinadora' : 'Administradora'}
            </p>
          </div>
          {!online && (
            <span className="chip shrink-0 bg-amber-100 text-amber-700">
              <WifiOffIcon className="text-sm" /> Sin conexión
            </span>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={handleLogout}
            className="tap rounded-full text-slate-400 active:bg-slate-100"
            title="Salir de la app"
            aria-label="Salir de la app"
          >
            <LogoutIcon className="text-xl" />
          </button>
        </div>
      </header>

      {/* Aviso de versión nueva */}
      {updateReady && (
        <div className="safe-x flex items-center gap-3 bg-primary-600 px-4 py-2 text-sm text-white">
          <span className="flex-1">Hay una versión nueva de la app.</span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('gemb:do-update'))}
            className="min-h-[36px] rounded-full bg-white/20 px-3 font-semibold"
          >
            Actualizar
          </button>
        </div>
      )}

      {/* Contenido */}
      <main className="safe-x flex-1 pb-6 pt-4">
        <Outlet />
      </main>

      {/* Navegación inferior. Es `sticky` (no `fixed`) para que en el iPhone
          no quede flotando encima de la lista con el teclado abierto.
          Con un solo apartado (coordinadoras) no se muestra: no aporta. */}
      {items.length > 1 && (
      <nav className="safe-bottom sticky bottom-0 z-40 border-t border-primary-100 bg-white/95 backdrop-blur">
        <div className="flex items-stretch justify-around">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center justify-center gap-0.5 px-2 pb-2 pt-2.5 text-[11px] font-semibold transition ${
                    isActive ? 'text-primary-600' : 'text-slate-400'
                  }`
                }
                style={{ minHeight: 56 }}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`text-2xl transition-transform ${
                        isActive ? 'scale-110' : ''
                      }`}
                    />
                    {item.label}
                    <span
                      className={`mt-0.5 h-0.5 w-6 rounded-full transition ${
                        isActive ? 'bg-primary-500' : 'bg-transparent'
                      }`}
                    />
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>
      )}
    </div>
  );
}

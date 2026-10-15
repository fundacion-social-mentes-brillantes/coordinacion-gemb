import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Logo } from './Logo';
import { ErrorBoundary } from './ErrorBoundary';
import { isUpdateReady } from '../lib/swUpdate';
import { listenPendingReviewCount } from '../services/members';
import { listenPendingUsersCount } from '../services/users';
import { nombreDeRol } from '../lib/constants';
import {
  CalendarIcon,
  ListCheckIcon,
  ChartIcon,
  UsersIcon,
  ShieldIcon,
  LogoutIcon,
  WifiOffIcon,
  SettingsIcon,
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
  // Las coordinadoras solo ven estos dos: tomar asistencia y el calendario
  // de quién coordina cada reunión (antes eran dos apps).
  { to: '/sesiones', label: 'Asistencia', icon: ListCheckIcon, roles: ALL },
  { to: '/programacion', label: 'Coordinación', icon: CalendarIcon, roles: ALL },
  // El panel y la administración son solo para admin/super_admin.
  { to: '/panel', label: 'Panel', icon: ChartIcon, roles: ADMIN },
  { to: '/personas', label: 'Personas', icon: UsersIcon, roles: ADMIN },
  { to: '/usuarios', label: 'Usuarios', icon: ShieldIcon, roles: ADMIN },
];

export function Layout() {
  const { profile, logout } = useAuth();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const location = useLocation();
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
  const esAdmin = role === 'admin' || role === 'super_admin';

  // Avisos para la administración: personas nuevas por revisar y gente que
  // entró con Google y espera que le den acceso.
  const [porRevisar, setPorRevisar] = useState(0);
  const [porAprobar, setPorAprobar] = useState(0);
  useEffect(() => {
    if (!esAdmin) return;
    const u1 = listenPendingReviewCount(setPorRevisar, (e) =>
      console.warn('No se pudo contar las personas por revisar', e),
    );
    const u2 = listenPendingUsersCount(setPorAprobar, (e) =>
      console.warn('No se pudo contar las solicitudes de acceso', e),
    );
    return () => {
      u1();
      u2();
    };
  }, [esAdmin]);
  const avisoDe = (to: string) =>
    to === '/personas' ? porRevisar : to === '/usuarios' ? porAprobar : 0;

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
    if (!(await logout())) return;
    navigate('/login', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col md:max-w-4xl">
      {/* Cabecera */}
      <header
        ref={headerRef}
        className="safe-top sticky top-0 z-40 border-b border-[color:var(--app-border)] bg-surface/70 backdrop-blur-xl"
      >
        {/* Con el iPhone en horizontal, el logo y "Salir" no pueden quedar
            bajo la muesca: el margen lateral respeta el área segura. */}
        <div
          className="flex items-center gap-2 py-2"
          style={{
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
          }}
        >
          <Logo className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1 md:mr-2">
            <p className="truncate text-[15px] font-bold leading-tight text-slate-900">
              {profile?.displayName || profile?.email}
            </p>
            <p className="truncate text-[12px] font-semibold leading-tight text-primary-500">
              {nombreDeRol(profile)}
            </p>
          </div>
          {items.length > 1 && (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Secciones">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `relative flex min-h-[40px] items-center gap-2 rounded-full px-3.5 text-sm font-bold transition ${
                        isActive
                          ? 'bg-primary-500/15 text-primary-500 shadow-[0_0_18px_-6px_rgb(var(--app-glow-1)/0.7)]'
                          : 'text-slate-500 hover:bg-white/5 hover:text-slate-800'
                      }`
                    }
                  >
                    <Icon className="text-lg" />
                    {item.label}
                    {avisoDe(item.to) > 0 && (
                      <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                        {avisoDe(item.to) > 9 ? '9+' : avisoDe(item.to)}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </nav>
          )}
          {!online && (
            // En celulares de 360-390 px el texto no cabía junto a los demás
            // botones y empujaba "Salir" fuera de la pantalla: ahí va solo el
            // ícono (la hoja de asistencia ya tiene su propio aviso).
            <span
              className="chip shrink-0 bg-amber-100 text-amber-700"
              role="status"
              aria-label="Sin conexión"
              title="Sin conexión"
            >
              <WifiOffIcon className="text-sm" />
              <span className="hidden sm:inline">Sin conexión</span>
            </span>
          )}
          {/* Ajustes: aquí dentro vive "Conectar con Claude", que antes
              estorbaba en Sesiones. Discreto, pero siempre a mano. */}
          <Link
            to="/ajustes"
            className="tap rounded-full text-slate-500 transition hover:text-primary-500 active:bg-slate-100"
            title="Ajustes"
            aria-label="Ajustes"
          >
            <SettingsIcon className="text-xl" />
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="tap rounded-full text-slate-500 transition hover:text-primary-500 active:bg-slate-100"
            title="Salir de la app"
            aria-label="Salir de la app"
          >
            <LogoutIcon className="text-xl" />
          </button>
        </div>
      </header>

      {/* Aviso de versión nueva */}
      {updateReady && (
        <div className="safe-x flex items-center gap-3 bg-primary-500 px-4 py-2 text-sm font-semibold text-white">
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

      {/* Contenido. Si una pantalla falla al pintarse, se muestra un aviso
          con "Recargar" en vez de dejar la app en blanco (en la app instalada
          no había forma de salir). */}
      <main className="safe-x flex-1 pb-6 pt-4">
        <ErrorBoundary resetKey={location.pathname}>
          {/* Cada pantalla entra suave (la clave reinicia la animación). */}
          <div key={location.pathname} className="entrar">
            <Outlet />
          </div>
        </ErrorBoundary>
      </main>

      {/* Navegación inferior. Es `sticky` (no `fixed`) para que en el iPhone
          no quede flotando encima de la lista con el teclado abierto.
          Con un solo apartado (coordinadoras) no se muestra: no aporta. */}
      {items.length > 1 && (
      <nav className="safe-bottom sticky bottom-0 z-40 border-t border-[color:var(--app-border)] bg-surface/75 backdrop-blur-xl md:hidden">
        <div
          className="flex items-stretch justify-around"
          style={{
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center justify-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-bold transition ${
                    isActive ? 'text-primary-500' : 'text-slate-500'
                  }`
                }
                style={{ minHeight: 56 }}
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`relative flex h-8 w-14 items-center justify-center rounded-full transition ${
                        isActive
                          ? 'bg-primary-500/15 shadow-[0_0_18px_-4px_rgb(var(--app-glow-1)/0.6)]'
                          : ''
                      }`}
                    >
                      <Icon className={`text-[22px] transition-transform ${isActive ? 'scale-110' : ''}`} />
                      {/* Aviso: hay algo esperando (personas o accesos). */}
                      {avisoDe(item.to) > 0 && (
                        <span className="absolute -top-1 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                          {avisoDe(item.to) > 9 ? '9+' : avisoDe(item.to)}
                        </span>
                      )}
                    </span>
                    {item.label}
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { listenSessions } from '../services/sessions';
import { useProgramacion } from '../hooks/useProgramacion';
import { useAbrirReunion } from '../hooks/useAbrirReunion';
import { useMiNombre } from '../hooks/useMiNombre';
import { hayReunion, moverDia, nombreActividades, planDeFecha } from '../lib/programacion';
import { capitalizeFirst, dayKey, fmtDateLong, toInputDate } from '../lib/dates';
import { SESSION_TYPE_LABELS } from '../lib/constants';
import { abrirLaApp, cerrarBurbuja, enAppAndroid } from '../lib/nativo';
import { RecursosReunion } from '../components/RecursosReunion';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Logo } from '../components/Logo';
import { HomeIcon, ListCheckIcon, XIcon } from '../components/Icons';
import type { Session } from '../types';

// ---------------------------------------------------------------------------
//  Lo que se ve dentro de la burbuja flotante de la app de Android: la
//  reunión de hoy (con su asistencia) y, debajo, la carpeta y los enlaces de
//  Meet. Pantalla angosta, sin la barra de pestañas.
// ---------------------------------------------------------------------------

/** El marco de la burbuja: cabecera mínima con "abrir la app" y "cerrar". */
export function LayoutBurbuja() {
  const headerRef = useRef<HTMLElement>(null);

  // Igual que en Layout: los buscadores pegajosos se ponen bajo la cabecera.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty(
        '--header-h',
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-[rgba(255,255,255,0.07)] bg-surface/70 backdrop-blur-2xl backdrop-saturate-150"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Logo className="h-8 w-8 shrink-0" />
          <Link to="/burbuja" className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-900">
            Reunión de hoy
          </Link>
          {enAppAndroid && (
            <>
              <button
                type="button"
                className="boton-redondo"
                onClick={() => void abrirLaApp()}
                aria-label="Abrir la app completa"
                title="Abrir la app completa"
              >
                <HomeIcon className="text-lg" />
              </button>
              <button
                type="button"
                className="boton-redondo"
                onClick={() => void cerrarBurbuja()}
                aria-label="Quitar la burbuja"
                title="Quitar la burbuja"
              >
                <XIcon className="text-lg" />
              </button>
            </>
          )}
        </div>
      </header>
      <main className="flex-1 px-4 pb-6 pt-3">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

/** La entrada de la burbuja: la reunión de hoy y sus recursos. */
export function BurbujaPage() {
  const { toast } = useToast();
  const prog = useProgramacion({ conSolicitudes: false });
  const abrirReunion = useAbrirReunion('/burbuja');
  const { miNombre } = useMiNombre(prog.config.coordinadoras);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      listenSessions(
        (list) => {
          setSessions(list);
          setLoading(false);
        },
        (e) => {
          console.error(e);
          toast('No se pudieron cargar las reuniones.', 'error');
          setLoading(false);
        },
      ),
    [toast],
  );

  const hoyKey = toInputDate(new Date());
  const planHoy = planDeFecha(hoyKey, prog.config, prog.dias);
  const reunionesHoy = planHoy && hayReunion(planHoy) ? planHoy.actividades : [];
  const sesionDe = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sessions) m.set(`${dayKey(s.date)}|${s.type}`, s);
    return m;
  }, [sessions]);
  const proxima = useMemo(() => {
    if (reunionesHoy.length) return null;
    for (let n = 1; n <= 62; n++) {
      const p = planDeFecha(moverDia(hoyKey, n), prog.config, prog.dias);
      if (p && hayReunion(p)) return p;
    }
    return null;
  }, [reunionesHoy.length, hoyKey, prog.config, prog.dias]);

  return (
    <div className="space-y-3">
      {prog.cargando || loading ? (
        <div className="card esqueleto h-[150px]" aria-hidden />
      ) : reunionesHoy.length > 0 && planHoy ? (
        reunionesHoy.map((t) => {
          const s = sesionDe.get(`${hoyKey}|${t}`);
          const n = Math.max(0, s?.presentCount ?? 0);
          const tuya = !!planHoy.coordinadora && planHoy.coordinadora === miNombre;
          return (
            <section key={t} className="card p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary-500">
                Hoy{planHoy.horario ? ` · ${planHoy.horario}` : ''}
              </p>
              <p className="mt-0.5 font-display text-xl font-bold leading-tight text-slate-900">
                {SESSION_TYPE_LABELS[t]}
              </p>
              <p className="mt-1.5 text-sm text-slate-600">
                {planHoy.coordinadora ? (
                  <>
                    Coordina{' '}
                    <strong className={tuya ? 'text-[#f5c451]' : 'text-slate-900'}>
                      {planHoy.coordinadora}
                      {tuya ? ' (tú)' : ''}
                    </strong>
                  </>
                ) : (
                  <span className="font-semibold text-[#ff6961]">Sin coordinadora</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => abrirReunion(planHoy, t, s)}
                className="btn-primary mt-3 min-h-[48px] w-full"
              >
                <ListCheckIcon className="text-xl" />
                {!s
                  ? 'Tomar asistencia'
                  : s.status === 'open'
                    ? `Seguir con la asistencia · ${n}`
                    : `Ver asistencia · ${n}`}
              </button>
            </section>
          );
        })
      ) : (
        <section className="card p-4">
          <p className="font-display text-lg font-bold text-slate-900">Hoy no hay reunión</p>
          {proxima && (
            <p className="mt-1 text-sm text-slate-600">
              La próxima: <strong className="text-slate-900">{capitalizeFirst(fmtDateLong(proxima.fecha))}</strong>{' '}
              · {nombreActividades(proxima.actividades)}
            </p>
          )}
        </section>
      )}

      <RecursosReunion primero={reunionesHoy[0]} />
    </div>
  );
}

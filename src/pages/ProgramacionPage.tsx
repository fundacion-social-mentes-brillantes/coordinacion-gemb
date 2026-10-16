import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useProgramacion } from '../hooks/useProgramacion';
import { useMiNombre } from '../hooks/useMiNombre';
import { useAbrirReunion } from '../hooks/useAbrirReunion';
import { useRecursosReunion } from '../hooks/useRecursosReunion';
import { listenSessions } from '../services/sessions';
import {
  atenderSolicitud,
  guardarConfig,
  guardarDia,
  guardarEnlaces,
  rechazarSolicitud,
  restaurarDia,
  soltarFecha,
  tomarFecha,
} from '../services/programacion';
import {
  DIA_CORTO,
  NOMBRES_DIA,
  festivosColombia,
  NOMBRES_MES,
  esEnlaceMeet,
  estadoDeFecha,
  hayReunion,
  mensajeCoordino,
  modalidadPorRegla,
  moverDia,
  nombreActividades,
  planDelMes,
  planNuevo,
  textoWhatsApp,
  type EnlacesMeet,
  type EstadoFecha,
  type FechaPlan,
  type ProgramacionConfig,
} from '../lib/programacion';
import { buildProgramacionImage, programacionImageName } from '../lib/programacionImage';
import { shareOrDownloadImage } from '../lib/shareImage';
import { exportPDF } from '../lib/export';
import { esperarConLimite } from '../lib/esperar';
import { dayKey, isValidDateKey } from '../lib/dates';
import { MODALITY_LABELS, SESSION_TYPES, SESSION_TYPE_LABELS } from '../lib/constants';
import type { Modality, Session, SessionType } from '../types';
import { Modal } from '../components/Modal';
import { CoordinatorPicker } from '../components/CoordinatorPicker';
import { Spinner } from '../components/Spinner';
import { ModalityBadge } from '../components/badges';
import {
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  DownloadIcon,
  EditIcon,
  ImageIcon,
  ListCheckIcon,
  SettingsIcon,
  ShareIcon,
} from '../components/Icons';
import { copiarTexto } from '../lib/nativo';

// ---------------------------------------------------------------------------
//  Coordinación (antes era otra app: "Calendario — Mentes Brillantes").
//
//  Un calendario de mes, como el de la Agenda: debajo de cada día con
//  reunión hay una rayita de color.
//    rojo    no hay coordinadora: falta alguien
//    verde   ya tiene coordinadora
//    dorado  te toca a ti (tu espacio)
//  Al tocar un día se ve la reunión y, según el caso, "Yo la coordino" (queda
//  tuya al instante), "Tomar asistencia" o, para quien programa, "Cambiar".
//  La misma vista sirve para la página pública /calendario, sin iniciar sesión.
// ---------------------------------------------------------------------------

/** La pantalla dentro de la app (con la barra de abajo). */
export function ProgramacionPage() {
  return <ProgramacionView publico={false} />;
}

const fechaLarga = (p: { diaSemana: number; fecha: Date }) =>
  `${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()} de ${NOMBRES_MES[
    p.fecha.getUTCMonth()
  ].toLowerCase()}`;

const minus = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * Los colores de la rayita (los de Apple): fijos, no cambian con el tema.
 * Rojo = falta coordinadora, verde = ya tiene, dorado = te toca a ti.
 */
const COLOR: Record<EstadoFecha, string> = {
  libre: '#ff453a',
  ocupada: '#30d158',
  tuya: '#f5c451',
  sin: 'rgba(142, 142, 147, 0.5)',
};
const LEYENDA: [EstadoFecha, string][] = [
  ['libre', 'Sin coordinadora'],
  ['ocupada', 'Con coordinadora'],
  ['tuya', 'Te toca'],
  ['sin', 'Sin reunión'],
];

/** Lunes primero, como en Colombia; las letras, como en el iPhone. */
const SEMANA = [1, 2, 3, 4, 5, 6, 0];
const LETRA_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export function ProgramacionView({ publico }: { publico: boolean }) {
  const { profile, puedeProgramar, isAdmin, isCoordinador } = useAuth();
  const conCuenta = !publico && !!profile;
  const puede = conCuenta && puedeProgramar;
  const { toast } = useToast();
  const abrirReunion = useAbrirReunion();
  const prog = useProgramacion({ conSolicitudes: puede });
  const { config, dias, solicitudes } = prog;
  const { miNombre, elegirMiNombre } = useMiNombre(config.coordinadoras);
  const yo = useMemo(
    () => (conCuenta ? { uid: profile?.uid, nombre: miNombre } : {}),
    [conCuenta, profile?.uid, miNombre],
  );

  const hoyKey = dayKey(new Date());
  const [anio, setAnio] = useState(Number(hoyKey.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoyKey.slice(5, 7)) - 1);
  const [elegido, setElegido] = useState(hoyKey);
  const plan = useMemo(() => planDelMes(anio, mes, config, dias), [anio, mes, config, dias]);
  const planDe = useMemo(() => new Map(plan.map((p) => [p.key, p])), [plan]);

  // Lo que de verdad pasó (solo con sesión iniciada: la asistencia no es
  // pública). Sirve para "Tomar asistencia" y para ver cuánta gente fue.
  const [sesiones, setSesiones] = useState<Session[]>([]);
  useEffect(() => {
    if (!conCuenta) return;
    return listenSessions(setSesiones, (e) => console.warn(e));
  }, [conCuenta]);
  const sesionDe = useMemo(() => {
    const m = new Map<string, Session>();
    // La lista viene de la más nueva a la más vieja: si un día hubo dos de
    // un mismo tipo, queda la primera que se creó.
    for (const s of sesiones) m.set(`${dayKey(s.date)}|${s.type}`, s);
    return m;
  }, [sesiones]);

  const [editando, setEditando] = useState<{ fecha: FechaPlan; nueva: boolean } | null>(null);
  const [eligiendoNombre, setEligiendoNombre] = useState<FechaPlan | null>(null);
  const [verSolicitudes, setVerSolicitudes] = useState(false);
  const [verAjustes, setVerAjustes] = useState(false);
  const [verCompartir, setVerCompartir] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Lo que se ve en el detalle: el día elegido, si es de este mes.
  const mesClave = `${anio}-${String(mes + 1).padStart(2, '0')}`;
  const elegidoKey = elegido.startsWith(mesClave) ? elegido : '';
  const elegidoPlan = elegidoKey ? planDe.get(elegidoKey) ?? null : null;

  const reuniones = plan.filter(hayReunion);
  const fueraDeTemporada =
    mesClave < config.desde.slice(0, 7) || mesClave > config.hasta.slice(0, 7);
  const libres = reuniones.filter((p) => !p.coordinadora && p.key >= hoyKey).length;
  const tuyas = conCuenta ? reuniones.filter((p) => estadoDeFecha(p, yo) === 'tuya').length : 0;

  /** Al cambiar de mes: hoy si cae ahí; si no, la primera reunión del mes. */
  const irAMes = (y: number, m: number) => {
    setAnio(y);
    setMes(m);
    const clave = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (hoyKey.startsWith(clave)) setElegido(hoyKey);
    else {
      const primera = planDelMes(y, m, config, dias).find(hayReunion);
      setElegido(primera?.key ?? `${clave}-01`);
    }
  };
  const cambiarMes = (delta: number) => {
    const n = mes + delta;
    if (n < 0) irAMes(anio - 1, 11);
    else if (n > 11) irAMes(anio + 1, 0);
    else irAMes(anio, n);
  };
  const enEsteMes = hoyKey.startsWith(mesClave);

  // Deslizar el dedo sobre el calendario cambia de mes, como en la Agenda.
  const toque = useRef<{ x: number; y: number } | null>(null);
  const alSoltar = (x: number, y: number) => {
    const t = toque.current;
    toque.current = null;
    if (!t) return;
    const dx = x - t.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(y - t.y) * 1.5) cambiarMes(dx < 0 ? 1 : -1);
  };

  // En el celular el detalle queda debajo: al tocar un día se asoma.
  const detalleRef = useRef<HTMLDivElement>(null);
  const elegirDia = (key: string) => {
    setElegido(key);
    requestAnimationFrame(() => {
      const el = detalleRef.current;
      if (!el || window.matchMedia('(min-width: 768px)').matches) return;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight - 160) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  /* -------- Yo la coordino / Soltar -------- */

  const tomar = async (p: FechaPlan, nombre = miNombre) => {
    if (!profile || ocupado) return;
    if (!nombre) {
      setEligiendoNombre(p);
      return;
    }
    setOcupado(p.key);
    const promesa = tomarFecha(p.key, nombre, profile);
    try {
      const ok = await esperarConLimite(promesa, 8000);
      if (ok) toast(`¡Listo! Coordinas el ${minus(fechaLarga(p))}.`, 'success');
      else {
        toast('Sin señal: quedará tuya al volver la conexión, si nadie la toma antes.', 'info');
        promesa.catch(() => toast(`El ${minus(fechaLarga(p))} lo tomó otra persona antes.`, 'error'));
      }
    } catch (e) {
      console.error(e);
      toast(
        (e as { code?: string })?.code === 'permission-denied'
          ? 'Otra persona la tomó un momento antes que tú.'
          : 'No se pudo guardar. Revisa la conexión.',
        'error',
      );
    } finally {
      setOcupado(null);
    }
  };

  const soltar = async (p: FechaPlan) => {
    if (!profile || ocupado) return;
    if (!window.confirm(`¿Soltar el ${minus(fechaLarga(p))}? Quedará libre para que otra persona la tome.`)) {
      return;
    }
    setOcupado(p.key);
    try {
      const ok = await esperarConLimite(soltarFecha(p.key, profile), 8000);
      toast(ok ? 'Listo: la fecha quedó libre.' : 'Sin señal: se soltará al volver la conexión.', ok ? 'success' : 'info');
    } catch (e) {
      console.error(e);
      toast('No se pudo soltar. Revisa la conexión.', 'error');
    } finally {
      setOcupado(null);
    }
  };

  const avisar = async (p: FechaPlan) => {
    const texto = mensajeCoordino(p, p.coordinadora);
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text: texto });
        return;
      } catch {
        /* cerró el menú: se copia */
      }
    }
    try {
      await copiarTexto(texto);
      toast('Mensaje copiado: pégalo en el grupo.', 'success');
    } catch {
      toast('No se pudo copiar el mensaje.', 'error');
    }
  };

  /* -------- Cuadrícula -------- */

  const totalDias = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const huecos = (new Date(Date.UTC(anio, mes, 1, 12)).getUTCDay() + 6) % 7;
  const celdas: (string | null)[] = [
    ...Array.from({ length: huecos }, () => null),
    ...Array.from({ length: totalDias }, (_, i) => `${mesClave}-${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="titulo-pantalla">Coordinación</h2>
          <p className="text-sm text-slate-500">
            {publico ? 'Quién coordina cada reunión.' : 'Toca un día para ver la reunión.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setVerCompartir(true)}
            className="boton-redondo h-11 w-11"
            aria-label="Compartir el mes"
            title="Compartir el mes"
          >
            <ShareIcon className="text-lg" />
          </button>
          {puede && (
            <button
              type="button"
              onClick={() => setVerAjustes(true)}
              className="boton-redondo h-11 w-11"
              aria-label="Ajustes del calendario"
              title="Ajustes del calendario"
            >
              <SettingsIcon className="text-lg" />
            </button>
          )}
        </div>
      </div>

      {/* Solicitudes que quedaron del Calendario viejo (quien programa) */}
      {puede && solicitudes.size > 0 && (
        <button
          type="button"
          onClick={() => setVerSolicitudes(true)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-left"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-lg font-bold text-white">
            {solicitudes.size}
          </span>
          <span className="min-w-0 flex-1 font-semibold text-amber-900">
            {solicitudes.size === 1
              ? 'Alguien pidió coordinar una fecha'
              : `${solicitudes.size} pedidos para coordinar fechas`}
          </span>
          <ChevronRightIcon className="text-xl text-amber-500" />
        </button>
      )}

      <div className="md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:items-start md:gap-4">
        {/* El mes */}
        <section
          className="card p-3 sm:p-4"
          onTouchStart={(e) => {
            const t = e.touches[0];
            toque.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const t = e.changedTouches[0];
            alSoltar(t.clientX, t.clientY);
          }}
        >
          <div className="flex items-center gap-2 px-1">
            <p className="min-w-0 flex-1 truncate text-[26px] font-extrabold leading-none tracking-tight text-slate-900">
              {NOMBRES_MES[mes]} <span className="font-semibold text-primary-500">{anio}</span>
            </p>
            <button type="button" onClick={() => cambiarMes(-1)} className="boton-redondo" aria-label="Mes anterior">
              <ChevronRightIcon className="rotate-180 text-xl" />
            </button>
            <button type="button" onClick={() => cambiarMes(1)} className="boton-redondo" aria-label="Mes siguiente">
              <ChevronRightIcon className="text-xl" />
            </button>
          </div>
          {enEsteMes ? (
            <p className="mt-1.5 px-1 text-[13px] text-slate-500">
              {prog.cargando
                ? 'Cargando…'
                : reuniones.length === 0
                  ? 'Sin reuniones'
                  : `${reuniones.length} reuniones · ${libres} sin coordinadora${
                      conCuenta ? ` · ${tuyas} tuya${tuyas === 1 ? '' : 's'}` : ''
                    }`}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => irAMes(Number(hoyKey.slice(0, 4)), Number(hoyKey.slice(5, 7)) - 1)}
              className="mt-1.5 px-1 text-[13px] font-semibold text-primary-500"
            >
              Volver a hoy
            </button>
          )}

          <div className="mt-4 grid grid-cols-7 text-center">
            {SEMANA.map((d) => (
              <abbr
                key={d}
                title={NOMBRES_DIA[d]}
                className="pb-1.5 text-[12px] font-semibold text-slate-500 no-underline"
              >
                {LETRA_DIA[d]}
              </abbr>
            ))}
          </div>

          {prog.cargando ? (
            <div className="flex h-[300px] items-center justify-center">
              <Spinner className="h-8 w-8" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-y-1" role="grid" aria-label={`${NOMBRES_MES[mes]} ${anio}`}>
              {celdas.map((key, i) => {
                if (!key) return <span key={`h${i}`} aria-hidden />;
                const p = planDe.get(key);
                const estado = p ? estadoDeFecha(p, yo) : null;
                const pasada = key < hoyKey;
                const esHoy = key === hoyKey;
                const sel = key === elegidoKey;
                const n = Number(key.slice(8));
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    aria-selected={sel}
                    aria-label={`${n}${
                      estado === 'libre'
                        ? ', sin coordinadora'
                        : estado === 'tuya'
                          ? ', te toca a ti'
                          : estado === 'ocupada'
                            ? `, coordina ${p?.coordinadora}`
                            : estado === 'sin'
                              ? ', no hay reunión'
                              : ''
                    }`}
                    onClick={() => elegirDia(key)}
                    className="relative mx-auto flex h-[58px] w-full max-w-[56px] flex-col items-center justify-start gap-1.5 rounded-[18px] pt-0.5 transition active:scale-90"
                  >
                    {/* Hoy: el círculo azul (como el rojo del Calendario de
                        Apple); el día elegido: una burbuja de vidrio. */}
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-[17px] leading-none transition ${
                        esHoy
                          ? `font-bold text-[#fff] ${sel ? 'ring-2 ring-[rgba(255,255,255,0.8)] ring-offset-0' : ''}`
                          : sel
                            ? 'burbuja font-bold text-slate-900'
                            : p
                              ? 'font-semibold text-slate-900'
                              : 'text-slate-500'
                      } ${pasada && !esHoy && !sel ? 'opacity-45' : ''}`}
                      style={
                        esHoy
                          ? {
                              background: 'var(--app-cta-gradient)',
                              boxShadow: '0 6px 18px -6px rgb(var(--app-cta-glow) / 0.95), inset 0 1px 0.5px rgba(255,255,255,0.5)',
                            }
                          : undefined
                      }
                    >
                      {n}
                    </span>
                    {estado && (
                      <span
                        className={`h-1 w-[22px] rounded-full ${pasada ? 'opacity-35' : ''}`}
                        style={{
                          background: COLOR[estado],
                          boxShadow: !pasada && estado !== 'sin' ? `0 0 9px ${COLOR[estado]}` : undefined,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Leyenda */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 border-t border-[rgba(255,255,255,0.07)] pt-3 text-[12px] font-medium text-slate-600">
            {LEYENDA.filter(([e]) => conCuenta || e !== 'tuya').map(([e, t]) => (
              <span key={e} className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.06)] px-2.5 py-1">
                <span className="h-1 w-3.5 rounded-full" style={{ background: COLOR[e] }} />
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* El día elegido */}
        <div ref={detalleRef} className="mt-4 scroll-mt-24 md:mt-0">
          {prog.error && plan.length === 0 ? (
            <p className="card p-4 text-center text-sm text-slate-500">
              No se pudo cargar el calendario. Revisa la conexión.
            </p>
          ) : !prog.cargando && plan.length === 0 ? (
            <div className="card p-5 text-center text-sm text-slate-500">
              No hay reuniones en {NOMBRES_MES[mes].toLowerCase()} de {anio}
              {fueraDeTemporada ? ': está fuera de la temporada.' : '.'}
              {puede && elegidoKey && (
                <button
                  type="button"
                  onClick={() => setEditando({ fecha: planNuevo(elegidoKey, config), nueva: true })}
                  className="btn-secondary mt-3 min-h-[44px] w-full text-sm"
                >
                  Programar una reunión el {Number(elegidoKey.slice(8))}
                </button>
              )}
            </div>
          ) : elegidoKey && !prog.cargando ? (
            <DetalleDia
              key={elegidoKey}
              diaKey={elegidoKey}
              p={elegidoPlan}
              hoyKey={hoyKey}
              estado={elegidoPlan ? estadoDeFecha(elegidoPlan, yo) : null}
              publico={!conCuenta}
              puede={puede}
              esStaff={conCuenta && isCoordinador}
              isAdmin={conCuenta && isAdmin}
              propia={!!elegidoPlan && !!profile && elegidoPlan.coordinadoraUid === profile.uid}
              solicitud={puede ? solicitudes.get(elegidoKey)?.nombre ?? '' : ''}
              sesiones={
                elegidoPlan
                  ? elegidoPlan.actividades.map((t) => [t, sesionDe.get(`${elegidoKey}|${t}`)] as const)
                  : []
              }
              ocupado={ocupado === elegidoKey}
              onTomar={() => elegidoPlan && tomar(elegidoPlan)}
              onSoltar={() => elegidoPlan && soltar(elegidoPlan)}
              onAvisar={() => elegidoPlan && avisar(elegidoPlan)}
              onEditar={() =>
                setEditando(
                  elegidoPlan
                    ? { fecha: elegidoPlan, nueva: false }
                    : { fecha: planNuevo(elegidoKey, config), nueva: true },
                )
              }
              onAsistencia={(t, s) => elegidoPlan && abrirReunion(elegidoPlan, t, s)}
            />
          ) : null}
        </div>
      </div>

      {publico && (
        <p className="px-2 text-center text-xs text-slate-400">
          ¿Eres del equipo? Entra con tu cuenta de Google para coordinar y tomar asistencia.
        </p>
      )}

      {/* Modales */}
      {editando && (
        <EditarFecha
          fecha={editando.fecha}
          nueva={editando.nueva}
          config={config}
          onClose={() => setEditando(null)}
        />
      )}
      {eligiendoNombre && (
        <ElegirMiNombre
          equipo={config.coordinadoras}
          onClose={() => setEligiendoNombre(null)}
          onElegir={(n) => {
            elegirMiNombre(n);
            const p = eligiendoNombre;
            setEligiendoNombre(null);
            void tomar(p, n);
          }}
        />
      )}
      {verSolicitudes && (
        <Modal open onClose={() => setVerSolicitudes(false)} title="Pedidos para coordinar">
          <ul className="space-y-3">
            {[...solicitudes.values()]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((s) => {
                const p = planDelMes(Number(s.id.slice(0, 4)), Number(s.id.slice(5, 7)) - 1, config, dias).find(
                  (x) => x.key === s.id,
                );
                return (
                  <li key={s.id} className="rounded-xl border border-[color:var(--app-border)] p-3">
                    <p className="font-semibold text-slate-800">{s.nombre}</p>
                    <p className="text-sm text-slate-500">
                      {p ? `${fechaLarga(p)} · ${nombreActividades(p.actividades)}` : s.id}
                    </p>
                    {p && <SolicitudBotones fecha={p} nombre={s.nombre} sinBorde />}
                  </li>
                );
              })}
          </ul>
        </Modal>
      )}
      {verAjustes && <Ajustes config={config} onClose={() => setVerAjustes(false)} />}
      {verCompartir && (
        <CompartirMes anio={anio} mes={mes} plan={plan} onClose={() => setVerCompartir(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* El detalle del día elegido                                          */
/* ------------------------------------------------------------------ */

function DetalleDia({
  diaKey,
  p,
  hoyKey,
  estado,
  publico,
  puede,
  esStaff,
  isAdmin,
  propia,
  solicitud,
  sesiones,
  ocupado,
  onTomar,
  onSoltar,
  onAvisar,
  onEditar,
  onAsistencia,
}: {
  diaKey: string;
  p: FechaPlan | null;
  hoyKey: string;
  estado: EstadoFecha | null;
  publico: boolean;
  puede: boolean;
  esStaff: boolean;
  isAdmin: boolean;
  /** Ella misma se la tomó (y por eso la puede soltar). */
  propia: boolean;
  solicitud: string;
  sesiones: (readonly [SessionType, Session | undefined])[];
  ocupado: boolean;
  onTomar: () => void;
  onSoltar: () => void;
  onAvisar: () => void;
  onEditar: () => void;
  onAsistencia: (t: SessionType, s?: Session) => void;
}) {
  const fecha = new Date(`${diaKey}T12:00:00Z`);
  const titulo = fechaLarga({ diaSemana: fecha.getUTCDay(), fecha });
  const esHoy = diaKey === hoyKey;
  const pasada = diaKey < hoyKey;
  // Las coordinadoras toman asistencia hasta anteayer (las reglas dejan
  // marcar hasta 72 horas después); la administración, cuando sea.
  const enVentana = diaKey <= hoyKey && (isAdmin || diaKey >= moverDia(hoyKey, -2));

  return (
    <section className="card entrar overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h3 className="min-w-0 flex-1 font-display text-lg font-bold leading-tight text-slate-900">
          {titulo}
        </h3>
        {esHoy && (
          <span className="chip text-[#fff]" style={{ background: 'var(--app-cta-gradient)' }}>
            Hoy
          </span>
        )}
      </div>

      {!p ? (
        <div className="space-y-3 p-4 pt-2">
          <p className="text-sm text-slate-500">Este día no hay reunión.</p>
          {puede && !pasada && (
            <button type="button" onClick={onEditar} className="btn-secondary min-h-[44px] w-full text-sm">
              Programar una reunión especial
            </button>
          )}
        </div>
      ) : !hayReunion(p) ? (
        <div className="space-y-3 p-4 pt-2">
          <p className="text-sm text-slate-500">{nombreActividades(p.actividades)}</p>
          <p className={`text-sm font-semibold ${p.festivo ? 'text-amber-700' : 'text-rose-700'}`}>
            {p.festivo ? `Festivo · ${p.festivo}. No hay reunión.` : `No hay reunión${p.motivo ? ` · ${p.motivo}` : ''}`}
          </p>
          {puede && (
            <button type="button" onClick={onEditar} className="btn-secondary min-h-[44px] w-full text-sm">
              <EditIcon className="text-base" /> Cambiar este día
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3 p-4 pt-1">
          <div>
            <p className="font-semibold text-primary-900">{nombreActividades(p.actividades)}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {p.horario && <span className="chip bg-slate-100 text-slate-600">{p.horario}</span>}
              {/* Si ya se hizo, cómo fue de verdad; si no, lo que dice el calendario. */}
              <ModalityBadge modality={sesiones.find(([, s]) => s)?.[1]?.modality ?? p.modalidad} />
              {p.especial && <span className="chip bg-accent-100 text-accent-700">Especial</span>}
            </div>
          </div>

          {/* Quién coordina */}
          <div
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{
              background: `color-mix(in srgb, ${COLOR[estado ?? 'sin']} 18%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${COLOR[estado ?? 'sin']} 35%, transparent)`,
            }}
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold"
              style={{
                background: COLOR[estado ?? 'sin'],
                color: estado === 'libre' ? '#ffffff' : '#08101f',
                boxShadow: `0 0 16px -2px ${COLOR[estado ?? 'sin']}`,
              }}
              aria-hidden
            >
              {estado === 'libre' ? (pasada ? '–' : '!') : estado === 'tuya' ? '★' : p.coordinadora.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {estado === 'libre' ? 'Sin coordinadora' : estado === 'tuya' ? 'Te toca a ti' : 'Coordina'}
              </p>
              <p className="truncate font-bold text-slate-900">
                {estado === 'libre' ? (pasada ? 'Nadie la tomó' : 'Nadie la coordina todavía') : p.coordinadora}
              </p>
            </div>
          </div>

          {/* Yo la coordino */}
          {esStaff && estado === 'libre' && !pasada && (
            <button type="button" onClick={onTomar} disabled={ocupado} className="btn-primary btn-lg">
              {ocupado ? <Spinner className="h-5 w-5 text-[#fff]" /> : <CheckIcon className="text-lg" />}
              Yo la coordino
            </button>
          )}

          {/* Tomar asistencia (las reuniones ya están "creadas") */}
          {esStaff &&
            sesiones.map(([t, s]) => {
              if (!s && !enVentana) return null;
              const n = Math.max(0, s?.presentCount ?? 0);
              const abierta = s?.status === 'open' && enVentana;
              const prefijo = p.actividades.length > 1 ? `${SESSION_TYPE_LABELS[t]}: ` : '';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onAsistencia(t, s)}
                  className={
                    // Si está libre, lo primero es "Yo la coordino".
                    esHoy && (!s || abierta) && estado !== 'libre'
                      ? 'btn-primary btn-lg'
                      : 'btn-secondary min-h-[48px] w-full text-sm'
                  }
                >
                  <ListCheckIcon className="text-lg" />
                  <span className="truncate">
                    {prefijo}
                    {!s
                      ? 'Tomar asistencia'
                      : abierta
                        ? `Seguir con la asistencia · ${n}`
                        : `Ver asistencia · ${n} presente${n === 1 ? '' : 's'}`}
                  </span>
                </button>
              );
            })}

          {estado === 'tuya' && !pasada && (
            <div className="flex gap-2">
              <button type="button" onClick={onAvisar} className="btn-secondary min-h-[44px] flex-1 text-sm">
                <ShareIcon className="text-base" /> Avisar al grupo
              </button>
              {propia && (
                <button
                  type="button"
                  onClick={onSoltar}
                  disabled={ocupado}
                  className="btn-ghost min-h-[44px] flex-1 text-sm text-rose-600"
                >
                  Ya no puedo
                </button>
              )}
            </div>
          )}
          {estado === 'tuya' && !pasada && !propia && !puede && (
            <p className="text-xs text-slate-500">
              Te la asignó la coordinación. Si no puedes, avísales para que la cambien.
            </p>
          )}

          {/* Sin cuenta (página pública) */}
          {publico && estado === 'libre' && !pasada && (
            <Link
              to="/login"
              state={{ from: { pathname: '/programacion' } }}
              className="btn-primary min-h-[48px] w-full text-sm"
            >
              Entra para coordinarla
            </Link>
          )}

          {/* Pedido viejo de "Apartar" */}
          {puede && solicitud && !p.coordinadora && <SolicitudBotones fecha={p} nombre={solicitud} sinBorde />}

          {puede && (
            <button type="button" onClick={onEditar} className="btn-ghost min-h-[44px] w-full text-sm">
              <EditIcon className="text-base" /> Cambiar este día
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ¿Cuál eres tú? (una sola vez por teléfono)                          */
/* ------------------------------------------------------------------ */

function ElegirMiNombre({
  equipo,
  onElegir,
  onClose,
}: {
  equipo: string[];
  onElegir: (nombre: string) => void;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState('');
  return (
    <Modal open onClose={onClose} title="¿Cuál eres tú?">
      {equipo.length === 0 ? (
        <p className="text-sm text-slate-600">
          Todavía no hay equipo en el calendario. Pídele a la coordinación que te agregue (Ajustes del
          calendario → Equipo que coordina).
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Elige tu nombre como aparece en el equipo. Solo se pregunta una vez en este teléfono.
          </p>
          <CoordinatorPicker value={nombre} onChange={setNombre} nombres={equipo} conLibre={false} />
          <p className="text-xs text-slate-500">
            ¿No estás en la lista? Pídele a la coordinación que te agregue al equipo.
          </p>
          <button
            type="button"
            disabled={!nombre}
            onClick={() => onElegir(nombre)}
            className="btn-primary btn-lg"
          >
            Soy {nombre || '…'}: coordinarla
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Compartir el mes (imagen, WhatsApp o PDF)                           */
/* ------------------------------------------------------------------ */

function CompartirMes({
  anio,
  mes,
  plan,
  onClose,
}: {
  anio: number;
  mes: number;
  plan: FechaPlan[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [armandoImagen, setArmandoImagen] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  const compartirImagen = async () => {
    setArmandoImagen(true);
    try {
      const blob = await buildProgramacionImage(anio, mes, plan);
      const r = await shareOrDownloadImage(
        blob,
        programacionImageName(anio, mes),
        `Programación ${NOMBRES_MES[mes]} ${anio}`,
      );
      if (r === 'downloaded') toast('Imagen descargada.', 'success');
      else if (r === 'opened') toast('Se abrió la imagen: mantenla pulsada para guardarla.', 'info');
      else if (r === 'blocked') toast('La imagen ya está lista: toca «Imagen» otra vez.', 'info');
      else if (r === 'error') toast('No se pudo compartir la imagen.', 'error');
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la imagen.', 'error');
    } finally {
      setArmandoImagen(false);
    }
  };

  const copiarWhatsApp = async () => {
    const texto = textoWhatsApp(anio, mes, plan);
    try {
      await copiarTexto(texto);
      toast('Copiado: pégalo en WhatsApp.', 'success');
      onClose();
    } catch {
      setManual(texto);
    }
  };

  const descargarPdf = () => {
    exportPDF({
      title: `Programación ${NOMBRES_MES[mes]} ${anio}`,
      subtitle: 'Gimnasio Emocional Mentes Brillantes',
      columns: ['Fecha', 'Reunión', 'Horario', 'Modalidad', 'Coordina'],
      rows: plan.map((p) => [
        `${DIA_CORTO[p.diaSemana]} ${p.fecha.getUTCDate()}`,
        nombreActividades(p.actividades),
        p.horario,
        hayReunion(p) ? MODALITY_LABELS[p.modalidad] : '—',
        p.festivo
          ? `Festivo: ${p.festivo}`
          : p.cancelada
            ? `No hay reunión${p.motivo ? ` (${p.motivo})` : ''}`
            : p.coordinadora || 'Sin coordinadora',
      ]),
      filename: `programacion-${NOMBRES_MES[mes].toLowerCase()}-${anio}`,
    }).catch((e) => {
      console.error(e);
      toast('No se pudo crear el PDF.', 'error');
    });
  };

  return (
    <Modal open onClose={onClose} title={`${NOMBRES_MES[mes]} ${anio}`}>
      {manual !== null ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Tu navegador no dejó copiarlo solo. Mantén pulsado el texto, selecciónalo todo y cópialo.
          </p>
          <textarea
            readOnly
            value={manual}
            onFocus={(e) => e.currentTarget.select()}
            className="input h-48 w-full text-xs"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={compartirImagen}
            disabled={armandoImagen || plan.length === 0}
            className="btn-secondary min-h-[52px] justify-start px-4"
          >
            {armandoImagen ? <Spinner className="h-5 w-5" /> : <ImageIcon className="text-xl" />}
            Imagen del mes
          </button>
          <button
            type="button"
            onClick={copiarWhatsApp}
            className="btn-secondary min-h-[52px] justify-start px-4"
          >
            <ClipboardIcon className="text-xl" /> Texto para WhatsApp
          </button>
          <button
            type="button"
            onClick={descargarPdf}
            disabled={plan.length === 0}
            className="btn-secondary min-h-[52px] justify-start px-4"
          >
            <DownloadIcon className="text-xl" /> PDF
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Atender una solicitud                                               */
/* ------------------------------------------------------------------ */

function SolicitudBotones({
  fecha,
  nombre,
  sinBorde = false,
}: {
  fecha: FechaPlan;
  nombre: string;
  sinBorde?: boolean;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);

  const hacer = async (aceptar: boolean) => {
    if (!profile) return;
    if (!aceptar && !window.confirm(`¿Rechazar la solicitud de ${nombre}? La fecha vuelve a quedar libre.`)) return;
    setOcupado(true);
    try {
      const ok = await esperarConLimite(
        aceptar ? atenderSolicitud(fecha.key, nombre, profile) : rechazarSolicitud(fecha.key),
      );
      toast(
        ok
          ? aceptar
            ? `${nombre} coordina el ${fechaLarga(fecha)}.`
            : 'Solicitud rechazada.'
          : 'Sin conexión: se guardará al volver la señal.',
        ok ? 'success' : 'info',
      );
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar.', 'error');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className={`flex gap-2 ${sinBorde ? 'mt-2' : 'border-t border-amber-100 bg-amber-50/50 px-4 py-2'}`}>
      <button type="button" disabled={ocupado} onClick={() => hacer(true)} className="btn-primary min-h-[44px] flex-1 text-sm">
        Asignar a {nombre.split(' ')[0]}
      </button>
      <button type="button" disabled={ocupado} onClick={() => hacer(false)} className="btn-ghost min-h-[44px] text-sm text-rose-600">
        Rechazar
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editar una fecha                                                    */
/* ------------------------------------------------------------------ */

function EditarFecha({
  fecha,
  nueva = false,
  config,
  onClose,
}: {
  fecha: FechaPlan;
  /** Ese día normalmente no hay reunión: se programa una especial. */
  nueva?: boolean;
  config: ProgramacionConfig;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const base = config.dias[String(fecha.diaSemana)];
  const porRegla = modalidadPorRegla(fecha.key, base, config);

  const [coordinadora, setCoordinadora] = useState(fecha.coordinadora);
  const [modo, setModo] = useState<'regla' | Modality>(fecha.modalidadFija ? fecha.modalidad : 'regla');
  const [horario, setHorario] = useState(fecha.horario === base?.horario ? '' : fecha.horario);
  const [actividades, setActividades] = useState<SessionType[]>(fecha.actividades);
  const [cancelada, setCancelada] = useState(fecha.cancelada);
  const [motivo, setMotivo] = useState(fecha.motivo);
  const [especial, setEspecial] = useState(fecha.especial);
  const [guardando, setGuardando] = useState(false);

  const festivo = festivoDe(fecha);
  const mismasActividades = (a: SessionType[], b: SessionType[]) =>
    a.length === b.length && a.every((x) => b.includes(x));

  const guardar = async () => {
    if (!profile || guardando) return;
    if (actividades.length === 0) {
      toast('Elige al menos una reunión.', 'error');
      return;
    }
    const cambios = {
      coordinadora: coordinadora.trim() || null,
      modalidad: modo === 'regla' ? null : modo,
      horario: horario.trim() || null,
      actividades: base && mismasActividades(actividades, base.actividades) ? null : actividades,
      cancelada: cancelada ? true : null,
      motivo: cancelada && motivo.trim() ? motivo.trim() : null,
      especial: especial ? true : null,
    };
    const vacio = Object.values(cambios).every((v) => v === null);
    setGuardando(true);
    try {
      const ok = await esperarConLimite(
        vacio ? restaurarDia(fecha.key) : guardarDia(fecha.key, cambios, profile, fecha.coordinadora),
      );
      toast(ok ? 'Guardado.' : 'Sin conexión: se guardará al volver la señal.', ok ? 'success' : 'info');
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar. Revisa la conexión.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const restaurar = async () => {
    if (!window.confirm('¿Volver a como dice la regla? Se quita quién coordina y los cambios de este día.')) return;
    setGuardando(true);
    try {
      await esperarConLimite(restaurarDia(fecha.key));
      toast('Ese día vuelve a lo normal.', 'success');
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={fechaLarga(fecha)}>
      <div className="space-y-5">
        {nueva && (
          <p className="rounded-xl bg-accent-50 p-3 text-sm text-accent-800">
            Normalmente este día no hay reunión. Al guardar queda programada una{' '}
            <strong>reunión especial</strong>.
          </p>
        )}
        {festivo && (
          <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5"
              checked={especial}
              onChange={(e) => setEspecial(e.target.checked)}
            />
            <span>
              Es festivo ({festivo}). Normalmente no hay reunión.
              <strong> Marca aquí si esta vez sí habrá.</strong>
            </span>
          </label>
        )}

        <div>
          <label className="label">¿Quién coordina?</label>
          <CoordinatorPicker value={coordinadora} onChange={setCoordinadora} nombres={config.coordinadoras} />
        </div>

        <div>
          <label className="label">Modalidad</label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['regla', `Normal (${MODALITY_LABELS[porRegla]})`],
                ['presencial', 'Presencial'],
                ['virtual', 'Virtual'],
              ] as ['regla' | Modality, string][]
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                onClick={() => setModo(v)}
                className={`min-h-[48px] rounded-xl border px-2 text-sm font-medium ${
                  modo === v ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Reunión</label>
          <div className="grid gap-2">
            {SESSION_TYPES.map((t) => {
              const sel = actividades.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => setActividades((a) => (sel ? a.filter((x) => x !== t) : [...a, t]))}
                  className={`min-h-[48px] rounded-xl border p-3 text-left text-sm font-medium ${
                    sel ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {sel ? '✓ ' : ''}
                  {SESSION_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="horario-dia">
            Horario
          </label>
          <input
            id="horario-dia"
            className="input"
            placeholder={base?.horario || 'Ej.: 5:30 PM - 6:45 PM'}
            value={horario}
            maxLength={40}
            onChange={(e) => setHorario(e.target.value)}
          />
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={cancelada}
            onChange={(e) => setCancelada(e.target.checked)}
          />
          <span className="text-slate-700">Este día no hay reunión</span>
        </label>
        {cancelada && (
          <input
            className="input"
            placeholder="Motivo (opcional), ej.: vacaciones"
            value={motivo}
            maxLength={120}
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}

        <button type="button" onClick={guardar} disabled={guardando} className="btn-primary btn-lg">
          {guardando ? <Spinner className="h-5 w-5 text-[#fff]" /> : 'Guardar'}
        </button>
        {!nueva && (
          <button
            type="button"
            onClick={restaurar}
            disabled={guardando}
            className="btn-ghost min-h-[44px] w-full text-sm text-slate-500"
          >
            {fecha.especial && !festivo ? 'Quitar esta reunión especial' : 'Volver a lo normal'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** El festivo de esa fecha, aunque se haya marcado "sí hay reunión". */
const festivoDe = (p: FechaPlan) => festivosColombia(p.fecha.getUTCFullYear()).get(p.key) ?? null;

/* ------------------------------------------------------------------ */
/* Ajustes del calendario                                              */
/* ------------------------------------------------------------------ */

function Ajustes({ config, onClose }: { config: ProgramacionConfig; onClose: () => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [c, setC] = useState<ProgramacionConfig>(() => JSON.parse(JSON.stringify(config)));
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const hoyKey = dayKey(new Date());
  const estaSemana = modalidadPorRegla(hoyKey, undefined, c);
  // Los enlaces de Meet llegan aparte (no son públicos): se copian al
  // borrador mientras la persona no haya empezado a cambiarlos.
  const { meet } = useRecursosReunion();
  const [enlaces, setEnlaces] = useState<EnlacesMeet>({});
  const tocoEnlaces = useRef(false);
  useEffect(() => {
    if (!tocoEnlaces.current) setEnlaces(meet);
  }, [meet]);

  const setDia = (k: string, cambios: Partial<ProgramacionConfig['dias'][string]>) =>
    setC((x) => ({ ...x, dias: { ...x.dias, [k]: { ...x.dias[k], ...cambios } } }));

  const agregar = () => {
    const n = nuevo.trim().replace(/\s+/g, ' ');
    if (n.length < 3) return;
    if (c.coordinadoras.some((x) => x.toLowerCase() === n.toLowerCase())) {
      toast('Ya está en el equipo.', 'info');
      return;
    }
    setC((x) => ({ ...x, coordinadoras: [...x.coordinadoras, n] }));
    setNuevo('');
  };

  const guardar = async () => {
    if (!profile || guardando) return;
    if (!isValidDateKey(c.desde) || !isValidDateKey(c.hasta) || c.desde > c.hasta) {
      toast('Revisa las fechas de la temporada.', 'error');
      return;
    }
    if (c.grupoWhatsapp && !/^https:\/\/(chat\.whatsapp\.com|wa\.me)\//.test(c.grupoWhatsapp)) {
      toast('El enlace del grupo debe empezar por https://chat.whatsapp.com/', 'error');
      return;
    }
    const enlacesLimpios: EnlacesMeet = {};
    for (const t of SESSION_TYPES) {
      const u = (enlaces[t] ?? '').trim();
      if (!u) continue;
      if (!esEnlaceMeet(u)) {
        toast(`El enlace de ${SESSION_TYPE_LABELS[t]} debe ser de Meet: https://meet.google.com/…`, 'error');
        return;
      }
      enlacesLimpios[t] = u;
    }
    const cambiaronEnlaces = SESSION_TYPES.some((t) => (enlacesLimpios[t] ?? '') !== (meet[t] ?? ''));
    setGuardando(true);
    try {
      const ok = await esperarConLimite(
        Promise.all([
          guardarConfig(c, profile),
          ...(cambiaronEnlaces ? [guardarEnlaces(enlacesLimpios, profile)] : []),
        ]),
      );
      toast(ok ? 'Calendario actualizado.' : 'Sin conexión: se guardará al volver la señal.', ok ? 'success' : 'info');
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Ajustes del calendario">
      <div className="space-y-6">
        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Temporada</h4>
          <p className="text-xs text-slate-500">Antes y después de estas fechas no hay reuniones (vacaciones).</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="input" value={c.desde} onChange={(e) => setC({ ...c, desde: e.target.value })} />
            <input type="date" className="input" value={c.hasta} onChange={(e) => setC({ ...c, hasta: e.target.value })} />
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Semana normal</h4>
          {[1, 2, 3, 4, 5, 6, 0].map((i) => {
            const k = String(i);
            const d = c.dias[k];
            return (
              <div key={k} className={`rounded-xl border p-3 ${d.activo ? 'border-primary-200' : 'border-slate-200'}`}>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={d.activo}
                    onChange={(e) => setDia(k, { activo: e.target.checked })}
                  />
                  <span className="font-semibold text-slate-800">{NOMBRES_DIA[i]}</span>
                </label>
                {d.activo && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {SESSION_TYPES.map((t) => {
                        const sel = d.actividades.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              setDia(k, {
                                actividades: sel ? d.actividades.filter((x) => x !== t) : [...d.actividades, t],
                              })
                            }
                            className={`chip min-h-[36px] ${sel ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                          >
                            {SESSION_TYPE_LABELS[t]}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      className="input"
                      placeholder="Horario, ej.: 5:30 PM - 6:45 PM"
                      value={d.horario}
                      maxLength={40}
                      onChange={(e) => setDia(k, { horario: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={d.siempreVirtual}
                        onChange={(e) => setDia(k, { siempreVirtual: e.target.checked })}
                      />
                      Siempre virtual
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Virtual o presencial</h4>
          <p className="text-xs text-slate-500">
            Las semanas se alternan. Con lo elegido, esta semana es{' '}
            <strong>{MODALITY_LABELS[estaSemana].toLowerCase()}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['par', 'Semanas pares virtuales'],
                ['impar', 'Semanas impares virtuales'],
              ] as ['par' | 'impar', string][]
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                onClick={() => setC({ ...c, semanasVirtuales: v })}
                className={`min-h-[48px] rounded-xl border px-2 text-sm font-medium ${
                  c.semanasVirtuales === v ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Equipo que coordina</h4>
          <ul className="flex flex-wrap gap-2">
            {c.coordinadoras.map((n) => (
              <li key={n} className="chip min-h-[36px] bg-primary-50 text-primary-800">
                {n}
                <button
                  type="button"
                  onClick={() => setC({ ...c, coordinadoras: c.coordinadoras.filter((x) => x !== n) })}
                  className="ml-1 rounded-full px-1 text-primary-400"
                  aria-label={`Quitar a ${n}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              agregar();
            }}
          >
            <input
              className="input flex-1"
              placeholder="Nombre y apellido"
              value={nuevo}
              maxLength={80}
              onChange={(e) => setNuevo(e.target.value)}
            />
            <button type="submit" className="btn-secondary">
              Agregar
            </button>
          </form>
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Grupo de WhatsApp</h4>
          <input
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://chat.whatsapp.com/…"
            value={c.grupoWhatsapp}
            onChange={(e) => setC({ ...c, grupoWhatsapp: e.target.value.trim() })}
          />
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-bold text-primary-900">Enlaces de Meet</h4>
          <p className="text-xs text-slate-500">
            Las coordinadoras los ven en Asistencia para entrar o copiarlos al grupo. No salen en el
            calendario público.
          </p>
          {SESSION_TYPES.map((t) => (
            <div key={t}>
              <label className="label" htmlFor={`meet-${t}`}>
                {SESSION_TYPE_LABELS[t]}
              </label>
              <input
                id={`meet-${t}`}
                className="input"
                type="url"
                inputMode="url"
                placeholder="https://meet.google.com/…"
                value={enlaces[t] ?? ''}
                onChange={(e) => {
                  tocoEnlaces.current = true;
                  const v = e.target.value.trim();
                  setEnlaces((x) => ({ ...x, [t]: v }));
                }}
              />
            </div>
          ))}
        </section>

        <button type="button" onClick={guardar} disabled={guardando} className="btn-primary btn-lg">
          {guardando ? <Spinner className="h-5 w-5 text-[#fff]" /> : 'Guardar ajustes'}
        </button>
      </div>
    </Modal>
  );
}

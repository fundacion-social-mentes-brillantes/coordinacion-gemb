import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useProgramacion } from '../hooks/useProgramacion';
import { listenSessions } from '../services/sessions';
import {
  atenderSolicitud,
  crearSolicitud,
  guardarConfig,
  guardarDia,
  rechazarSolicitud,
  restaurarDia,
} from '../services/programacion';
import {
  DIA_CORTO,
  NOMBRES_DIA,
  festivosColombia,
  NOMBRES_MES,
  hayReunion,
  mensajeApartado,
  modalidadPorRegla,
  nombreActividades,
  nombreDelEquipo,
  planDelMes,
  textoWhatsApp,
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
  ChevronRightIcon,
  ClipboardIcon,
  DownloadIcon,
  ImageIcon,
  SettingsIcon,
  ShareIcon,
} from '../components/Icons';

// ---------------------------------------------------------------------------
//  Calendario (antes era otra app: "Calendario — Mentes Brillantes").
//
//  Muestra la programación del mes: cada reunión con su horario, modalidad y
//  quién la coordina. Quien puede programar (administración o el permiso
//  "Programación") asigna coordinadoras y cambia días; el resto del equipo
//  puede "Apartar" una fecha libre. La misma vista sirve para la página
//  pública /calendario, sin iniciar sesión.
// ---------------------------------------------------------------------------

/** La pantalla dentro de la app (con la barra de abajo). */
export function ProgramacionPage() {
  return <ProgramacionView publico={false} />;
}

const fechaLarga = (p: FechaPlan) =>
  `${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()} de ${NOMBRES_MES[
    p.fecha.getUTCMonth()
  ].toLowerCase()}`;

export function ProgramacionView({ publico }: { publico: boolean }) {
  const { profile, puedeProgramar } = useAuth();
  const puede = !publico && puedeProgramar && !!profile;
  const { toast } = useToast();
  const navigate = useNavigate();
  const prog = useProgramacion();
  const { config, dias, solicitudes } = prog;

  const hoyKey = dayKey(new Date());
  const [anio, setAnio] = useState(Number(hoyKey.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoyKey.slice(5, 7)) - 1);
  const plan = useMemo(() => planDelMes(anio, mes, config, dias), [anio, mes, config, dias]);

  // Lo que de verdad pasó (solo con sesión iniciada: la asistencia no es
  // pública). Sirve para mostrar, en fechas pasadas, cuánta gente fue.
  const [sesiones, setSesiones] = useState<Session[]>([]);
  useEffect(() => {
    if (publico || !profile) return;
    return listenSessions(setSesiones, (e) => console.warn(e));
  }, [publico, profile]);
  const sesionDe = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sesiones) m.set(`${dayKey(s.date)}|${s.type}`, s);
    return m;
  }, [sesiones]);

  const [editando, setEditando] = useState<FechaPlan | null>(null);
  const [apartando, setApartando] = useState<FechaPlan | null>(null);
  const [verSolicitudes, setVerSolicitudes] = useState(false);
  const [verAjustes, setVerAjustes] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [armandoImagen, setArmandoImagen] = useState(false);

  /** Las sesiones que de verdad se hicieron (hasta hoy) de esa fecha. */
  const realesDe = (p: FechaPlan) =>
    p.key > hoyKey
      ? []
      : p.actividades
          .map((t) => sesionDe.get(`${p.key}|${t}`))
          .filter((s): s is Session => !!s);
  /** Lo que de verdad fue (si ya se hizo) o lo que dice el calendario. */
  const modalidadDe = (p: FechaPlan): Modality => realesDe(p)[0]?.modality ?? p.modalidad;

  const reuniones = plan.filter(hayReunion);
  const mesClave = `${anio}-${String(mes + 1).padStart(2, '0')}`;
  const fueraDeTemporada =
    mesClave < config.desde.slice(0, 7) || mesClave > config.hasta.slice(0, 7);
  const resumen = {
    total: reuniones.length,
    asignadas: reuniones.filter((p) => p.coordinadora).length,
    virtuales: reuniones.filter((p) => modalidadDe(p) === 'virtual').length,
    presenciales: reuniones.filter((p) => modalidadDe(p) === 'presencial').length,
  };

  const copiar = async (texto: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast(ok, 'success');
    } catch {
      setManual(texto);
    }
  };

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
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la imagen.', 'error');
    } finally {
      setArmandoImagen(false);
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
            : p.coordinadora || 'Disponible',
      ]),
      filename: `programacion-${NOMBRES_MES[mes].toLowerCase()}-${anio}`,
    }).catch((e) => {
      console.error(e);
      toast('No se pudo crear el PDF.', 'error');
    });
  };

  const cambiarMes = (delta: number) => {
    const n = mes + delta;
    if (n < 0) {
      setMes(11);
      setAnio((a) => a - 1);
    } else if (n > 11) {
      setMes(0);
      setAnio((a) => a + 1);
    } else setMes(n);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="titulo-pantalla">Calendario</h2>
          <p className="text-sm text-slate-500">Quién coordina cada reunión.</p>
        </div>
        {puede && (
          <button
            type="button"
            onClick={() => setVerAjustes(true)}
            className="btn-secondary min-h-[44px] shrink-0 px-3 text-sm"
            aria-label="Ajustes del calendario"
          >
            <SettingsIcon className="text-lg" /> Ajustar
          </button>
        )}
      </div>

      {/* Mes */}
      <div className="card flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => cambiarMes(-1)}
          className="tap rounded-full text-primary-700 active:bg-primary-50"
          aria-label="Mes anterior"
        >
          <ChevronRightIcon className="rotate-180 text-xl" />
        </button>
        <p className="flex-1 text-center text-base font-bold text-primary-900">
          {NOMBRES_MES[mes]} {anio}
        </p>
        <button
          type="button"
          onClick={() => cambiarMes(1)}
          className="tap rounded-full text-primary-700 active:bg-primary-50"
          aria-label="Mes siguiente"
        >
          <ChevronRightIcon className="text-xl" />
        </button>
      </div>

      {/* Solicitudes pendientes (quien programa) */}
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
              : `${solicitudes.size} solicitudes para coordinar fechas`}
          </span>
          <ChevronRightIcon className="text-xl text-amber-500" />
        </button>
      )}

      {/* Resumen */}
      {!prog.cargando && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ['Reuniones', resumen.total],
              ['Asignadas', resumen.asignadas],
              ['Virtuales', resumen.virtuales],
              ['Presenciales', resumen.presenciales],
            ] as [string, number][]
          ).map(([t, n]) => (
            <div key={t} className="card px-1 py-2">
              <p className="text-xl font-bold text-primary-800">{n}</p>
              <p className="text-[11px] text-slate-500">{t}</p>
            </div>
          ))}
        </div>
      )}

      {/* Compartir */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={compartirImagen}
          disabled={armandoImagen || plan.length === 0}
          className="btn-secondary min-h-[48px] px-2 text-sm"
        >
          {armandoImagen ? <Spinner className="h-4 w-4" /> : <ImageIcon className="text-lg" />} Imagen
        </button>
        <button
          type="button"
          onClick={() => copiar(textoWhatsApp(anio, mes, plan), 'Copiado: pégalo en WhatsApp.')}
          className="btn-secondary min-h-[48px] px-2 text-sm"
        >
          <ClipboardIcon className="text-lg" /> WhatsApp
        </button>
        <button
          type="button"
          onClick={descargarPdf}
          disabled={plan.length === 0}
          className="btn-secondary min-h-[48px] px-2 text-sm"
        >
          <DownloadIcon className="text-lg" /> PDF
        </button>
      </div>

      {/* Fechas */}
      {prog.cargando ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : prog.error && plan.length === 0 ? (
        <p className="card p-4 text-center text-sm text-slate-500">
          No se pudo cargar el calendario. Revisa la conexión.
        </p>
      ) : plan.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">
          No hay reuniones programadas en {NOMBRES_MES[mes].toLowerCase()} de {anio}
          {fueraDeTemporada ? ': está fuera de la temporada.' : '.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {plan.map((p) => {
            const solicitud = solicitudes.get(p.key);
            const reales = realesDe(p);
            const pasada = p.key < hoyKey;
            const esHoy = p.key === hoyKey;
            const activa = hayReunion(p);
            const puedeApartar =
              !puede && activa && !p.coordinadora && !solicitud && !pasada && config.coordinadoras.length > 0;
            const modalidad = modalidadDe(p);
            return (
              <li
                key={p.key}
                className={`card overflow-hidden ${esHoy ? 'ring-2 ring-primary-400' : ''} ${
                  activa ? '' : 'opacity-75'
                }`}
              >
                <button
                  type="button"
                  disabled={!puede}
                  onClick={() => setEditando(p)}
                  className="flex w-full items-start gap-3 p-4 text-left disabled:cursor-default enabled:active:bg-primary-50"
                >
                  <div
                    className={`flex w-14 shrink-0 flex-col items-center rounded-xl py-2 ${
                      activa ? 'bg-primary-500 text-white shadow-[0_8px_20px_-10px_rgb(var(--app-glow-1)/0.8)]' : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    <span className="text-[11px] font-bold tracking-wide opacity-80">
                      {DIA_CORTO[p.diaSemana]}
                    </span>
                    <span className="text-2xl font-extrabold leading-none">{p.fecha.getUTCDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold text-primary-900 ${activa ? '' : 'line-through'}`}>
                      {nombreActividades(p.actividades)}
                    </p>
                    {p.festivo ? (
                      <p className="mt-1 text-sm font-medium text-amber-700">Festivo · {p.festivo}</p>
                    ) : p.cancelada ? (
                      <p className="mt-1 text-sm font-medium text-rose-700">
                        No hay reunión{p.motivo ? ` · ${p.motivo}` : ''}
                      </p>
                    ) : (
                      <>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="chip bg-slate-100 text-slate-600">{p.horario}</span>
                          <ModalityBadge modality={modalidad} />
                          {esHoy && <span className="chip bg-primary-100 text-primary-700">Hoy</span>}
                        </div>
                        <p className="mt-1.5 text-sm">
                          {p.coordinadora ? (
                            <span className="font-semibold text-slate-800">Coordina: {p.coordinadora}</span>
                          ) : solicitud ? (
                            <span className="font-semibold text-amber-700">
                              En revisión: {solicitud.nombre}
                            </span>
                          ) : (
                            <span className="font-medium text-emerald-700">Disponible</span>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                  {puede && <ChevronRightIcon className="mt-1 text-xl text-slate-300" />}
                </button>

                {/* Lo que pasó de verdad */}
                {reales.length > 0 && (
                  <div className="border-t border-primary-100 bg-primary-50/40 px-4 py-2">
                    {reales.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => navigate(`/sesiones/${s.id}`)}
                        className="flex min-h-[40px] w-full items-center gap-2 text-left text-sm text-primary-800"
                      >
                        <span className="min-w-0 flex-1">
                          {p.actividades.length > 1 ? `${SESSION_TYPE_LABELS[s.type]}: ` : ''}
                          {Math.max(0, s.presentCount ?? 0)} presentes
                          {s.coordinator && s.coordinator !== p.coordinadora
                            ? ` · coordinó ${s.coordinator}`
                            : ''}
                        </span>
                        <ChevronRightIcon className="text-lg text-primary-300" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Atender una solicitud ahí mismo */}
                {puede && solicitud && activa && !p.coordinadora && (
                  <SolicitudBotones fecha={p} nombre={solicitud.nombre} />
                )}

                {puedeApartar && (
                  <div className="border-t border-slate-100 px-4 py-2">
                    <button
                      type="button"
                      onClick={() => setApartando(p)}
                      className="btn-secondary min-h-[44px] w-full text-sm"
                    >
                      Apartar esta fecha
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {publico && (
        <p className="px-2 text-center text-xs text-slate-400">
          ¿Eres del equipo? Entra a la app para ver también la asistencia de cada reunión.
        </p>
      )}

      {/* Modales */}
      {editando && (
        <EditarFecha fecha={editando} config={config} onClose={() => setEditando(null)} />
      )}
      {apartando && (
        <Apartar
          fecha={apartando}
          config={config}
          sugerido={profile ? nombreDelEquipo(profile.displayName, config.coordinadoras) : ''}
          onClose={() => setApartando(null)}
        />
      )}
      {verSolicitudes && (
        <Modal open onClose={() => setVerSolicitudes(false)} title="Solicitudes">
          <ul className="space-y-3">
            {[...solicitudes.values()]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((s) => {
                const p = planDelMes(Number(s.id.slice(0, 4)), Number(s.id.slice(5, 7)) - 1, config, dias).find(
                  (x) => x.key === s.id,
                );
                return (
                  <li key={s.id} className="rounded-xl border border-slate-200 p-3">
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
      <Modal open={manual !== null} onClose={() => setManual(null)} title="Copia esto">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Tu navegador no dejó copiarlo solo. Mantén pulsado el texto, selecciónalo todo y cópialo.
          </p>
          <textarea
            readOnly
            value={manual ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            className="input h-48 w-full text-xs"
          />
        </div>
      </Modal>
    </div>
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
  config,
  onClose,
}: {
  fecha: FechaPlan;
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
        vacio ? restaurarDia(fecha.key) : guardarDia(fecha.key, cambios, profile),
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
          {guardando ? <Spinner className="h-5 w-5 text-white" /> : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={restaurar}
          disabled={guardando}
          className="btn-ghost min-h-[44px] w-full text-sm text-slate-500"
        >
          Volver a lo normal
        </button>
      </div>
    </Modal>
  );
}

/** El festivo de esa fecha, aunque se haya marcado "sí hay reunión". */
const festivoDe = (p: FechaPlan) => festivosColombia(p.fecha.getUTCFullYear()).get(p.key) ?? null;

/* ------------------------------------------------------------------ */
/* Apartar una fecha                                                   */
/* ------------------------------------------------------------------ */

function Apartar({
  fecha,
  config,
  sugerido,
  onClose,
}: {
  fecha: FechaPlan;
  config: ProgramacionConfig;
  sugerido: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [nombre, setNombre] = useState(config.coordinadoras.includes(sugerido) ? sugerido : '');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const mensaje = mensajeApartado(fecha, nombre);

  const enviar = async () => {
    if (!nombre || enviando) return;
    setEnviando(true);
    try {
      const ok = await esperarConLimite(crearSolicitud(fecha.key, nombre), 8000);
      if (!ok) {
        toast('Sin conexión: la solicitud se enviará al volver la señal.', 'info');
      }
      setListo(true);
    } catch (e) {
      console.error(e);
      toast(
        'No se pudo apartar: quizá alguien la pidió o la asignaron hace un momento. Recarga la página.',
        'error',
      );
    } finally {
      setEnviando(false);
    }
  };

  const compartir = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ text: mensaje });
        return;
      } catch {
        /* cerró el menú: se copia */
      }
    }
    try {
      await navigator.clipboard.writeText(mensaje);
      toast('Mensaje copiado: pégalo en el grupo.', 'success');
    } catch {
      toast('No se pudo copiar el mensaje.', 'error');
    }
  };

  return (
    <Modal open onClose={onClose} title={listo ? 'Solicitud enviada' : 'Apartar esta fecha'}>
      {listo ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Quedó <strong>en revisión</strong>. La coordinación la confirma y te aparece asignada. Avisa en
            el grupo:
          </p>
          <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{mensaje}</pre>
          <button type="button" onClick={compartir} className="btn-primary btn-lg">
            <ShareIcon className="text-lg" /> Compartir el mensaje
          </button>
          {config.grupoWhatsapp && (
            <a
              href={config.grupoWhatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary min-h-[48px] w-full"
            >
              Abrir el grupo de WhatsApp
            </a>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Vas a pedir coordinar <strong>{nombreActividades(fecha.actividades)}</strong> el{' '}
            <strong>{fechaLarga(fecha)}</strong> ({fecha.horario}, {MODALITY_LABELS[fecha.modalidad]}).
          </p>
          <div>
            <label className="label">¿Quién eres?</label>
            <CoordinatorPicker
              value={nombre}
              onChange={setNombre}
              nombres={config.coordinadoras}
              conLibre={false}
            />
          </div>
          <button type="button" onClick={enviar} disabled={!nombre || enviando} className="btn-primary btn-lg">
            {enviando ? <Spinner className="h-5 w-5 text-white" /> : 'Pedir esta fecha'}
          </button>
        </div>
      )}
    </Modal>
  );
}

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
    setGuardando(true);
    try {
      const ok = await esperarConLimite(guardarConfig(c, profile));
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

        <button type="button" onClick={guardar} disabled={guardando} className="btn-primary btn-lg">
          {guardando ? <Spinner className="h-5 w-5 text-white" /> : 'Guardar ajustes'}
        </button>
      </div>
    </Modal>
  );
}

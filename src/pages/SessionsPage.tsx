import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  listenSessions,
  createSession,
  setSessionStatus,
  deleteSession,
} from '../services/sessions';
import type { Session, SessionType, Modality } from '../types';
import {
  SESSION_TYPES,
  MODALITIES,
  SESSION_TYPE_LABELS,
  MODALITY_LABELS,
} from '../lib/constants';
import {
  capitalizeFirst,
  dayKey,
  daysFromToday,
  fmtDateLong,
  fromInputDate,
  isValidDateKey,
  toDate,
  toInputDate,
} from '../lib/dates';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Modal } from '../components/Modal';
import { CoordinatorPicker } from '../components/CoordinatorPicker';
import { InstallButton, IosInstallHelp } from '../components/InstallPrompt';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { TypeBadge, ModalityBadge, StatusBadge } from '../components/badges';
import {
  PlusIcon,
  CalendarIcon,
  ChevronRightIcon,
  TrashIcon,
} from '../components/Icons';

/** El tipo de reunión que toca ese día: martes Ego, jueves Pasos. */
function tipoDelDia(key: string): SessionType | null {
  const dia = new Date(`${key}T12:00:00Z`).getUTCDay();
  if (dia === 2) return 'reduccion_ego';
  if (dia === 4) return 'entrega_pasos';
  return null;
}

export function SessionsPage() {
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [fType, setFType] = useState<SessionType | 'all'>('all');
  const [fModality, setFModality] = useState<Modality | 'all'>('all');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Crear
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState<SessionType | null>(null);
  const [newModality, setNewModality] = useState<Modality>('presencial');
  const [newDate, setNewDate] = useState(toInputDate(new Date()));
  const [newCoordinator, setNewCoordinator] = useState('');
  // Si ya existe la de ese tipo y día: se ofrece abrirla en vez de duplicarla.
  const [yaExiste, setYaExiste] = useState<Session | null>(null);

  useEffect(() => {
    const unsub = listenSessions(
      (list) => {
        setSessions(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar las sesiones.', 'error');
        setLoading(false);
      },
    );
    return unsub;
  }, [toast]);

  const hayFiltros = fType !== 'all' || fModality !== 'all' || !!fFrom || !!fTo;

  // Los filtros de fecha comparan el DÍA (en Bogotá) como texto
  // "aaaa-mm-dd": antes se corrían un día por la hora guardada.
  const filtered = useMemo(
    () =>
      sessions.filter((s) => {
        if (fType !== 'all' && s.type !== fType) return false;
        if (fModality !== 'all' && s.modality !== fModality) return false;
        const k = dayKey(s.date);
        if (fFrom && k < fFrom) return false;
        if (fTo && k > fTo) return false;
        return true;
      }),
    [sessions, fType, fModality, fFrom, fTo],
  );

  // Hoy arriba; luego las agendadas (la más próxima primero) y después las
  // anteriores. Antes una agendada para la otra semana quedaba ENCIMA de la
  // de hoy y era fácil tomar ahí la lista de hoy.
  const grupos = useMemo(() => {
    const hoy: Session[] = [];
    const proximas: Session[] = [];
    const anteriores: Session[] = [];
    for (const s of filtered) {
      const d = daysFromToday(s.date);
      if (d === 0) hoy.push(s);
      else if (d > 0) proximas.push(s);
      else anteriores.push(s);
    }
    proximas.sort((a, b) => toDate(a.date).getTime() - toDate(b.date).getTime());
    return { hoy, proximas, anteriores };
  }, [filtered]);

  // Sesiones de días pasados que nadie finalizó (siguen abiertas).
  const olvidadas = useMemo(
    () => sessions.filter((s) => s.status === 'open' && daysFromToday(s.date) < 0),
    [sessions],
  );

  const openCreate = () => {
    const hoy = toInputDate(new Date());
    setNewType(tipoDelDia(hoy));
    setNewModality('presencial');
    setNewDate(hoy);
    setNewCoordinator('');
    setYaExiste(null);
    setCreating(true);
  };

  const handleCreate = (otraMas = false) => {
    if (!profile || !newType) return;
    if (!isValidDateKey(newDate)) {
      toast('Elige la fecha de la sesión.', 'error');
      return;
    }
    // ¿Ya existe la de ese tipo ese día? Abrirla, no duplicarla.
    if (!otraMas) {
      const misma = sessions.find(
        (s) => s.type === newType && dayKey(s.date) === newDate,
      );
      if (misma) {
        setYaExiste(misma);
        return;
      }
    }
    const { id, done } = createSession(
      {
        type: newType,
        modality: newModality,
        date: fromInputDate(newDate),
        coordinator: newCoordinator,
      },
      profile,
      { otraMas },
    );
    done.catch((e) => {
      console.error(e);
      // Rechazada = alguien creó esa misma sesión un instante antes: la
      // pantalla ya está en ella (mismo id), con la lista de la otra persona.
      if ((e as { code?: string })?.code !== 'permission-denied') {
        toast('No se pudo crear la sesión. Revisa la conexión.', 'error');
      }
    });
    const dias = daysFromToday(fromInputDate(newDate));
    toast(
      dias > 0
        ? 'Sesión agendada. Ese día se podrá tomar lista.'
        : online
          ? 'Sesión creada.'
          : 'Sesión creada (se enviará al recuperar la señal).',
      'success',
    );
    setCreating(false);
    setYaExiste(null);
    navigate(`/sesiones/${id}`);
  };

  const toggleStatus = (s: Session) => {
    const cerrar = s.status === 'open';
    if (
      !window.confirm(
        cerrar
          ? `¿Finalizar la sesión del ${fmtDateLong(s.date)}? Las coordinadoras ya no podrán modificarla.`
          : `¿Reabrir la sesión del ${fmtDateLong(s.date)}? Las coordinadoras podrán volver a modificarla.`,
      )
    )
      return;
    setSessionStatus(s.id, cerrar ? 'closed' : 'open').catch((e) => {
      console.error(e);
      toast('No se pudo cambiar el estado.', 'error');
    });
    toast(cerrar ? 'Sesión finalizada.' : 'Sesión reabierta.', 'success');
  };

  const finalizarOlvidadas = () => {
    if (
      !window.confirm(
        `¿Finalizar las ${olvidadas.length} sesiones de días anteriores que siguen abiertas? Su asistencia se conserva tal como está.`,
      )
    )
      return;
    for (const s of olvidadas) {
      setSessionStatus(s.id, 'closed').catch((e) => console.error(e));
    }
    toast(`Se finalizaron ${olvidadas.length} sesiones.`, 'success');
  };

  const remove = async (s: Session) => {
    if (
      !window.confirm(
        `¿Borrar esta sesión y toda su asistencia? Esta acción no se puede deshacer.`,
      )
    )
      return;
    if (!online) {
      toast('Para eliminar una sesión necesitas conexión a internet.', 'error');
      return;
    }
    try {
      await deleteSession(s.id);
      toast('Sesión eliminada.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo eliminar la sesión. Revisa la conexión e inténtalo de nuevo.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-primary-900">Sesiones</h2>

      <button type="button" onClick={openCreate} className="btn-primary btn-lg">
        <PlusIcon className="text-xl" /> Nueva sesión
      </button>

      {/* Instalar la app (aquí sigue disponible tras iniciar sesión). */}
      <InstallButton className="btn-secondary min-h-[48px] w-full text-sm" />
      <IosInstallHelp />

      {/* Conectar con Claude se movió a Ajustes (rueda dentada, arriba):
          se hace una sola vez y aquí competía con "Nueva sesión". */}

      {/* Filtros */}
      <div className="card p-3">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex min-h-[44px] w-full items-center justify-between text-[15px] font-medium text-slate-600"
        >
          <span>Buscar por fecha o tipo</span>
          <span className="text-primary-500">
            {showFilters ? 'Ocultar' : 'Mostrar'}
          </span>
        </button>
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label">Tipo</label>
              <select
                className="input"
                value={fType}
                onChange={(e) => setFType(e.target.value as SessionType | 'all')}
              >
                <option value="all">Todos</option>
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SESSION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Modalidad</label>
              <select
                className="input"
                value={fModality}
                onChange={(e) =>
                  setFModality(e.target.value as Modality | 'all')
                }
              >
                <option value="all">Todas</option>
                {MODALITIES.map((m) => (
                  <option key={m} value={m}>
                    {MODALITY_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Desde</label>
              <input
                type="date"
                className="input"
                value={fFrom}
                onChange={(e) => setFFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input
                type="date"
                className="input"
                value={fTo}
                onChange={(e) => setFTo(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sesiones de días pasados que nadie finalizó. */}
      {isAdmin && olvidadas.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {olvidadas.length === 1
              ? 'Hay 1 sesión de un día anterior sin finalizar.'
              : `Hay ${olvidadas.length} sesiones de días anteriores sin finalizar.`}
          </p>
          <p className="mt-1">
            Mientras sigan abiertas se pueden modificar por error. Su asistencia
            se conserva al finalizarlas.
          </p>
          <button
            type="button"
            onClick={finalizarOlvidadas}
            className="btn-secondary mt-3 min-h-[44px] w-full text-sm"
          >
            Finalizar {olvidadas.length === 1 ? 'esa sesión' : `las ${olvidadas.length}`}
          </button>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : filtered.length === 0 && hayFiltros ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="Ninguna sesión con esos filtros"
          description="Prueba con otras fechas o tipo."
          action={
            <button
              onClick={() => {
                setFType('all');
                setFModality('all');
                setFFrom('');
                setFTo('');
              }}
              className="btn-secondary"
            >
              Quitar filtros
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="No hay sesiones"
          description="Crea la primera sesión para empezar a tomar asistencia."
          action={
            <button onClick={openCreate} className="btn-primary">
              <PlusIcon className="text-lg" /> Nueva sesión
            </button>
          }
        />
      ) : (
        <div className="space-y-5">
          {(
            [
              ['Hoy', grupos.hoy],
              ['Agendadas', grupos.proximas],
              ['Anteriores', grupos.anteriores],
            ] as [string, Session[]][]
          )
            .filter(([, lista]) => lista.length > 0)
            .map(([titulo, lista]) => (
              <section key={titulo}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {titulo}
                </h3>
                <ul className="space-y-3">
                  {lista.map((s) => {
                    const today = titulo === 'Hoy';
                    return (
                      <li
                        key={s.id}
                        className={`card overflow-hidden ${today ? 'ring-2 ring-primary-400' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => navigate(`/sesiones/${s.id}`)}
                          className="flex w-full items-center gap-3 p-4 text-left transition active:scale-[.985] active:bg-primary-100"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-primary-900">
                              {capitalizeFirst(fmtDateLong(s.date))}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <TypeBadge type={s.type} />
                              <ModalityBadge modality={s.modality} />
                              <StatusBadge status={s.status} />
                            </div>
                            <p className="mt-1.5 text-xs text-slate-500">
                              {Math.max(0, s.presentCount ?? 0)} presente
                              {Math.max(0, s.presentCount ?? 0) === 1 ? '' : 's'}
                              {s.coordinator ? ` · Coordina: ${s.coordinator}` : ''}
                            </p>
                          </div>
                          <ChevronRightIcon className="text-xl text-slate-300" />
                        </button>
                        {isAdmin && (
                          <div className="flex items-center gap-2 border-t border-primary-100 bg-primary-50/40 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => toggleStatus(s)}
                              className="btn-ghost min-h-[44px] text-sm"
                            >
                              {s.status === 'open' ? 'Finalizar' : 'Reabrir'}
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(s)}
                              className="btn-ghost ml-auto min-h-[44px] text-sm text-rose-600"
                            >
                              <TrashIcon className="text-base" /> Eliminar
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </div>
      )}

      {/* Modal crear */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
          setYaExiste(null);
        }}
        title={yaExiste ? 'Esa sesión ya existe' : 'Nueva sesión'}
      >
        {yaExiste ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-primary-50 p-4">
              <p className="font-semibold text-primary-900">
                {capitalizeFirst(fmtDateLong(yaExiste.date))}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <TypeBadge type={yaExiste.type} />
                <ModalityBadge modality={yaExiste.modality} />
                <StatusBadge status={yaExiste.status} />
              </div>
              <p className="mt-1.5 text-sm text-slate-600">
                {Math.max(0, yaExiste.presentCount ?? 0)} presente(s)
                {yaExiste.coordinator ? ` · Coordina: ${yaExiste.coordinator}` : ''}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              Alguien ya la creó. Ábrela y sigue tomando lista ahí: así no quedan
              dos listas del mismo día.
            </p>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                navigate(`/sesiones/${yaExiste.id}`);
                setYaExiste(null);
              }}
              className="btn-primary btn-lg"
            >
              Abrir esa sesión
            </button>
            <button
              type="button"
              onClick={() => handleCreate(true)}
              className="btn-ghost min-h-[44px] w-full text-sm"
            >
              No, es otra reunión distinta ese día: crear otra
            </button>
          </div>
        ) : (
        <div className="space-y-5">
          <div>
            <label className="label">Tipo de reunión</label>
            <div className="grid gap-2">
              {SESSION_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewType(t)}
                  className={`rounded-xl border p-3 text-left text-sm font-medium transition ${
                    newType === t
                      ? 'border-primary-500 bg-primary-50 text-primary-800'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {SESSION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Modalidad</label>
            <div className="grid grid-cols-2 gap-2">
              {MODALITIES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setNewModality(m)}
                  className={`rounded-xl border p-3 text-sm font-medium transition ${
                    newModality === m
                      ? 'border-primary-500 bg-primary-50 text-primary-800'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  {MODALITY_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="sesion-fecha">
              Fecha
            </label>
            <input
              id="sesion-fecha"
              type="date"
              className="input"
              value={newDate}
              onChange={(e) => {
                setNewDate(e.target.value);
                // Al cambiar el día, sugiere el tipo que toca ese día.
                const t = isValidDateKey(e.target.value) ? tipoDelDia(e.target.value) : null;
                if (t) setNewType(t);
              }}
            />
            {isValidDateKey(newDate) && daysFromToday(fromInputDate(newDate)) > 0 && (
              <p className="mt-1.5 text-xs text-amber-700">
                Quedará agendada: ese día se podrá tomar lista.
              </p>
            )}
          </div>

          <div>
            <label className="label">¿Quién coordina? (opcional)</label>
            <CoordinatorPicker value={newCoordinator} onChange={setNewCoordinator} />
          </div>

          <button
            type="button"
            onClick={() => handleCreate()}
            disabled={!newType || !isValidDateKey(newDate)}
            className="btn-primary w-full"
          >
            {newType ? 'Crear sesión' : 'Elige el tipo de reunión'}
          </button>
        </div>
        )}
      </Modal>
    </div>
  );
}

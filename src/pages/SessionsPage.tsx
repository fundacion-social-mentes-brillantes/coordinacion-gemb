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
import { fmtDateLong, toDate, toInputDate, fromInputDate } from '../lib/dates';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { TypeBadge, ModalityBadge, StatusBadge } from '../components/badges';
import {
  PlusIcon,
  CalendarIcon,
  ChevronRightIcon,
  TrashIcon,
} from '../components/Icons';

export function SessionsPage() {
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

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
  const [newType, setNewType] = useState<SessionType>('entrega_pasos');
  const [newModality, setNewModality] = useState<Modality>('presencial');
  const [newDate, setNewDate] = useState(toInputDate(new Date()));
  const [saving, setSaving] = useState(false);

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

  const filtered = useMemo(() => {
    const from = fFrom ? fromInputDate(fFrom).getTime() : -Infinity;
    const to = fTo ? fromInputDate(fTo).getTime() + 86_400_000 : Infinity;
    return sessions.filter((s) => {
      if (fType !== 'all' && s.type !== fType) return false;
      if (fModality !== 'all' && s.modality !== fModality) return false;
      const t = toDate(s.date).getTime();
      return t >= from && t <= to;
    });
  }, [sessions, fType, fModality, fFrom, fTo]);

  const openCreate = () => {
    setNewType('entrega_pasos');
    setNewModality('presencial');
    setNewDate(toInputDate(new Date()));
    setCreating(true);
  };

  const handleCreate = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const id = await createSession(
        { type: newType, modality: newModality, date: fromInputDate(newDate) },
        profile,
      );
      toast('Sesión creada.', 'success');
      setCreating(false);
      navigate(`/sesiones/${id}`);
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la sesión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (s: Session) => {
    try {
      await setSessionStatus(s.id, s.status === 'open' ? 'closed' : 'open');
      toast(s.status === 'open' ? 'Sesión cerrada.' : 'Sesión reabierta.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo cambiar el estado.', 'error');
    }
  };

  const remove = async (s: Session) => {
    if (
      !window.confirm(
        `¿Borrar esta sesión y toda su asistencia? Esta acción no se puede deshacer.`,
      )
    )
      return;
    try {
      await deleteSession(s.id);
      toast('Sesión eliminada.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo eliminar la sesión.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary-900">Sesiones</h2>
        <button type="button" onClick={openCreate} className="btn-primary py-2.5">
          <PlusIcon className="text-lg" /> Nueva sesión
        </button>
      </div>

      {/* Filtros */}
      <div className="card p-3">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-slate-600"
        >
          <span>Filtros</span>
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

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
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
        <ul className="space-y-3">
          {filtered.map((s) => (
            <li key={s.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => navigate(`/sesiones/${s.id}`)}
                className="flex w-full items-center gap-3 p-4 text-left active:bg-primary-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold capitalize text-primary-900">
                    {fmtDateLong(s.date)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <TypeBadge type={s.type} />
                    <ModalityBadge modality={s.modality} />
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {Math.max(0, s.presentCount ?? 0)} presente
                    {Math.max(0, s.presentCount ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <ChevronRightIcon className="text-xl text-slate-300" />
              </button>
              {isAdmin && (
                <div className="flex items-center gap-2 border-t border-primary-100 bg-primary-50/40 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => toggleStatus(s)}
                    className="btn-ghost text-sm"
                  >
                    {s.status === 'open' ? 'Cerrar' : 'Reabrir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    className="btn-ghost ml-auto text-sm text-rose-600"
                  >
                    <TrashIcon className="text-base" /> Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Modal crear */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nueva sesión"
      >
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
            <label className="label">Fecha</label>
            <input
              type="date"
              className="input"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="btn-primary w-full"
          >
            {saving ? <Spinner className="h-5 w-5 text-white" /> : null}
            Crear sesión
          </button>
        </div>
      </Modal>
    </div>
  );
}

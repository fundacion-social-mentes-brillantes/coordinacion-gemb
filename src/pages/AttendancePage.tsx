import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { listenSession, setSessionStatus } from '../services/sessions';
import {
  listenAttendance,
  markPresent,
  unmarkPresent,
} from '../services/attendance';
import { listenMembers, createMember } from '../services/members';
import type { Attendance, Member, Session } from '../types';
import { buildFuse, searchMembers, toSearchable } from '../lib/search';
import { fmtDateLong, fmtTime, toDate } from '../lib/dates';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { TypeBadge, ModalityBadge, StatusBadge } from '../components/badges';
import {
  ArrowLeftIcon,
  SearchIcon,
  CheckIcon,
  PlusIcon,
  XIcon,
  UserPlusIcon,
} from '../components/Icons';

export function AttendancePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile, isAdmin } = useAuth();
  const { toast } = useToast();
  const online = useOnlineStatus();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Attendance[]>([]);
  const [pendingSync, setPendingSync] = useState(false);
  const [query, setQuery] = useState('');
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkinName, setWalkinName] = useState('');
  const [walkinSaving, setWalkinSaving] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  // --- Suscripciones en vivo ---
  useEffect(() => {
    const unsub = listenSession(
      id,
      (s) => {
        setSession(s);
        setSessionLoading(false);
      },
      (e) => {
        console.error(e);
        setSessionLoading(false);
      },
    );
    return unsub;
  }, [id]);

  useEffect(() => {
    const unsub = listenMembers(
      (list) => setMembers(list),
      (e) => console.error(e),
      { activeOnly: true },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!id) return;
    const unsub = listenAttendance(
      id,
      (list, meta) => {
        setRows(list);
        setPendingSync(meta.hasPendingWrites);
      },
      (e) => console.error(e),
    );
    return unsub;
  }, [id]);

  // Enfoca la búsqueda al abrir.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // --- Búsqueda difusa ---
  const searchable = useMemo(() => toSearchable(members), [members]);
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);
  const results = useMemo(
    () => searchMembers(fuse, searchable, query),
    [fuse, searchable, query],
  );

  const presentIds = useMemo(() => new Set(rows.map((r) => r.memberId)), [rows]);
  const presentSorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => toDate(b.checkedInAt).getTime() - toDate(a.checkedInAt).getTime(),
      ),
    [rows],
  );

  const isOpen = session?.status === 'open';

  const toggle = async (member: Pick<Member, 'id' | 'fullName'>) => {
    if (!session || !profile) return;
    if (!isOpen) {
      toast('La sesión está cerrada. Reábrela para marcar.', 'info');
      return;
    }
    try {
      if (presentIds.has(member.id)) {
        await unmarkPresent(session.id, member.id);
      } else {
        await markPresent(session, member, profile);
      }
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar. Se reintentará al reconectar.', 'error');
    }
  };

  const handleWalkin = async () => {
    if (!session || !profile) return;
    const name = walkinName.trim();
    if (!name) return;
    setWalkinSaving(true);
    try {
      const memberId = await createMember({ fullName: name }, profile.uid);
      await markPresent(session, { id: memberId, fullName: name }, profile);
      toast(`${name} agregada y marcada presente.`, 'success');
      setWalkinName('');
      setWalkinOpen(false);
    } catch (e) {
      console.error(e);
      toast('No se pudo agregar la persona.', 'error');
    } finally {
      setWalkinSaving(false);
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter con un único resultado = marcar rápido.
    if (e.key === 'Enter' && results.length === 1) {
      e.preventDefault();
      toggle(results[0]);
      setQuery('');
    }
  };

  const reopenAndMark = async () => {
    if (!session) return;
    await setSessionStatus(session.id, 'open');
    toast('Sesión reabierta.', 'success');
  };

  if (sessionLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!session) {
    return (
      <EmptyState
        title="Sesión no encontrada"
        description="Es posible que haya sido eliminada."
        action={
          <button onClick={() => navigate('/sesiones')} className="btn-primary">
            Volver a sesiones
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-cabecera de la sesión */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/sesiones')}
          className="btn-ghost -ml-2 mb-1 text-sm"
        >
          <ArrowLeftIcon className="text-lg" /> Sesiones
        </button>
        <h2 className="text-lg font-bold capitalize text-primary-900">
          {fmtDateLong(session.date)}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <TypeBadge type={session.type} />
          <ModalityBadge modality={session.modality} />
          <StatusBadge status={session.status} />
        </div>
      </div>

      {/* Avisos de conexión / cierre */}
      {!online && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          Sin conexión. Puedes seguir marcando; se sincronizará al reconectar.
        </div>
      )}
      {online && pendingSync && (
        <div className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-700">
          Sincronizando cambios…
        </div>
      )}
      {!isOpen && (
        <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
          <span>La sesión está cerrada; no se puede marcar.</span>
          {isAdmin && (
            <button onClick={reopenAndMark} className="btn-ghost text-sm">
              Reabrir
            </button>
          )}
        </div>
      )}

      {/* Buscador */}
      <div className="sticky top-[61px] z-30 -mx-4 bg-surface px-4 pb-2 pt-1">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Buscar por nombre o apellido…"
            className="input py-3.5 pl-11 pr-11 text-base"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Limpiar búsqueda"
            >
              <XIcon className="text-lg" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="chip bg-primary-100 text-primary-700">
            Presentes: {rows.length}
          </span>
          <button
            type="button"
            onClick={() => setWalkinOpen(true)}
            disabled={!isOpen}
            className="btn-ghost text-sm"
          >
            <UserPlusIcon className="text-lg" /> Agregar persona
          </button>
        </div>
      </div>

      {/* Resultados de búsqueda */}
      {query.trim().length >= 2 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Resultados
          </h3>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
              Nadie coincide con “{query}”.
              <button
                type="button"
                onClick={() => {
                  setWalkinName(query.trim());
                  setWalkinOpen(true);
                }}
                className="mt-2 block w-full text-primary-600 underline"
              >
                Agregar “{query.trim()}” como persona nueva
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((m) => {
                const present = presentIds.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m)}
                      className={`flex min-h-[56px] w-full items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[.99] ${
                        present
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          present
                            ? 'bg-primary-500 text-white'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {present ? (
                          <CheckIcon className="text-lg" />
                        ) : (
                          <PlusIcon className="text-lg" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">
                          {m.fullName}
                        </span>
                        {present && (
                          <span className="block text-xs text-primary-600">
                            Presente
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Lista de presentes */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Presentes de hoy ({rows.length})
        </h3>
        {rows.length === 0 ? (
          <EmptyState
            icon={<CheckIcon />}
            title="Aún no hay presentes"
            description="Busca a una persona arriba y tócala para marcarla."
          />
        ) : (
          <ul className="space-y-2">
            {presentSorted.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-xl border border-primary-100 bg-white p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
                  <CheckIcon className="text-lg" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">
                    {r.fullName}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {fmtTime(r.checkedInAt)} · {r.checkedInByName}
                  </p>
                </div>
                {isOpen && (
                  <button
                    type="button"
                    onClick={() => toggle({ id: r.memberId, fullName: r.fullName })}
                    className="rounded-full p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                    aria-label={`Quitar a ${r.fullName}`}
                  >
                    <XIcon className="text-lg" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Modal walk-in */}
      <Modal
        open={walkinOpen}
        onClose={() => setWalkinOpen(false)}
        title="Agregar persona nueva"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Se creará en la base y quedará marcada presente en esta sesión.
          </p>
          <div>
            <label className="label">Nombre completo</label>
            <input
              autoFocus
              className="input"
              value={walkinName}
              onChange={(e) => setWalkinName(e.target.value)}
              placeholder="Ej. Johana Rendón"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleWalkin();
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleWalkin}
            disabled={walkinSaving || !walkinName.trim()}
            className="btn-primary w-full"
          >
            {walkinSaving ? <Spinner className="h-5 w-5 text-white" /> : null}
            Agregar y marcar presente
          </button>
        </div>
      </Modal>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  listenSession,
  setSessionStatus,
  setSessionCoordinator,
} from '../services/sessions';
import {
  listenAttendance,
  markPresent,
  unmarkPresent,
} from '../services/attendance';
import { listenMembers, createMember } from '../services/members';
import { resolvePlaceholderName, mergeMemberInto } from '../services/identify';
import type { Attendance, Member, Session } from '../types';
import { buildFuse, searchMembers, toSearchable } from '../lib/search';
import { UNKNOWN_PREFIX } from '../lib/constants';
import { fmtDateLong, fmtTime, toDate } from '../lib/dates';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { CoordinatorPicker } from '../components/CoordinatorPicker';
import { TypeBadge, ModalityBadge, StatusBadge } from '../components/badges';
import {
  ArrowLeftIcon,
  SearchIcon,
  CheckIcon,
  PlusIcon,
  XIcon,
  UserPlusIcon,
  LeafIcon,
  EditIcon,
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
  // Modo "no sé su nombre" del modal de agregar.
  const [walkinUnknown, setWalkinUnknown] = useState(false);
  const [walkinDesc, setWalkinDesc] = useState('');
  // Quién coordina.
  const [coordOpen, setCoordOpen] = useState(false);
  const [coordDraft, setCoordDraft] = useState('');
  const [coordSaving, setCoordSaving] = useState(false);
  // Ponerle nombre a una persona "Por identificar".
  const [resolveTarget, setResolveTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

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
  // Orden de llegada: primero en llegar = número 1.
  const presentByArrival = useMemo(
    () =>
      [...rows].sort(
        (a, b) => toDate(a.checkedInAt).getTime() - toDate(b.checkedInAt).getTime(),
      ),
    [rows],
  );

  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );
  // ¿Es una persona marcada sin nombre? (por bandera o por el prefijo).
  const isPlaceholder = (memberId: string, name: string) =>
    membersById.get(memberId)?.pendingIdentify === true ||
    name.startsWith(UNKNOWN_PREFIX);
  const placeholderCount = useMemo(
    () => members.filter((m) => m.pendingIdentify).length,
    [members],
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

  // Al elegir a alguien desde el buscador: márcalo y limpia la búsqueda para
  // pasar rápido al siguiente nombre (el foco vuelve al buscador).
  const pickFromSearch = (member: Pick<Member, 'id' | 'fullName'>) => {
    toggle(member);
    setQuery('');
    searchRef.current?.focus();
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

  // Marca presente a alguien cuyo nombre aún no se sabe: se crea como
  // "Por identificar N — seña" y después se corrige con "Poner nombre".
  const handleUnknownWalkin = async () => {
    if (!session || !profile) return;
    setWalkinSaving(true);
    try {
      const desc = walkinDesc.trim();
      const n = placeholderCount + 1;
      const name = `${UNKNOWN_PREFIX} ${n}${desc ? ` (${desc})` : ''}`;
      const memberId = await createMember(
        {
          fullName: name,
          notes: desc ? `Señas: ${desc}` : '',
          pendingIdentify: true,
        },
        profile.uid,
      );
      await markPresent(session, { id: memberId, fullName: name }, profile);
      toast(
        'Quedó presente. Cuando sepas su nombre, usa "Poner nombre" en la hoja.',
        'success',
      );
      setWalkinDesc('');
      setWalkinUnknown(false);
      setWalkinOpen(false);
    } catch (e) {
      console.error(e);
      toast('No se pudo agregar la persona.', 'error');
    } finally {
      setWalkinSaving(false);
    }
  };

  const saveCoordinator = async () => {
    if (!session) return;
    setCoordSaving(true);
    try {
      await setSessionCoordinator(session.id, coordDraft);
      toast(
        coordDraft.trim()
          ? `Coordina: ${coordDraft.trim()}.`
          : 'Quedó sin coordinadora asignada.',
        'success',
      );
      setCoordOpen(false);
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar quién coordina.', 'error');
    } finally {
      setCoordSaving(false);
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
        <button
          type="button"
          onClick={() => {
            setCoordDraft(session.coordinator ?? '');
            setCoordOpen(true);
          }}
          className="mt-2 flex items-center gap-1.5 text-sm text-primary-700"
        >
          <EditIcon className="text-base" />
          {session.coordinator ? (
            <span>
              Coordina: <strong>{session.coordinator}</strong>
            </span>
          ) : (
            <span className="underline">Asignar quién coordina</span>
          )}
        </button>
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
                      onClick={() => pickFromSearch(m)}
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

      {/* Hoja de asistencia — en orden de llegada */}
      <section
        className="overflow-hidden rounded-2xl border shadow-card"
        style={{ borderColor: 'var(--app-border)', background: 'var(--app-panel)' }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{
            background: 'var(--app-accent-gradient)',
            color: 'var(--app-on-accent)',
          }}
        >
          <span className="flex items-center gap-2 font-semibold">
            <LeafIcon className="text-lg" /> Hoja de asistencia
          </span>
          <span className="rounded-full bg-black/15 px-2.5 py-0.5 text-sm font-bold">
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--app-strong)' }}
            >
              Aún no hay presentes
            </p>
            <p className="mt-1 text-sm" style={{ color: 'var(--app-faint)' }}>
              Busca a una persona arriba y tócala para marcarla.
            </p>
          </div>
        ) : (
          <ol>
            {presentByArrival.map((r, i) => (
              <li
                key={r.id}
                className="flex items-center gap-3 border-t px-4 py-3"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{
                    background: 'var(--app-soft-solid)',
                    color: 'var(--app-accent)',
                  }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate font-medium"
                    style={{ color: 'var(--app-strong)' }}
                  >
                    {r.fullName}
                  </p>
                  <p
                    className="truncate text-xs"
                    style={{ color: 'var(--app-faint)' }}
                  >
                    Llegó {fmtTime(r.checkedInAt)} · {r.checkedInByName}
                  </p>
                </div>
                {isPlaceholder(r.memberId, r.fullName) && (
                  <button
                    type="button"
                    onClick={() =>
                      setResolveTarget({ id: r.memberId, name: r.fullName })
                    }
                    className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-800"
                  >
                    Poner nombre
                  </button>
                )}
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
          </ol>
        )}
      </section>

      {/* Modal walk-in (con nombre o sin saberlo todavía) */}
      <Modal
        open={walkinOpen}
        onClose={() => {
          setWalkinOpen(false);
          setWalkinUnknown(false);
        }}
        title={walkinUnknown ? 'Marcar sin saber el nombre' : 'Agregar persona nueva'}
      >
        {walkinUnknown ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Quedará presente como «{UNKNOWN_PREFIX}». Cuando sepas quién es,
              toca <strong>Poner nombre</strong> en la hoja de asistencia y el
              registro se corrige solo.
            </p>
            <div>
              <label className="label">¿Cómo la reconoces? (opcional)</label>
              <input
                autoFocus
                className="input"
                value={walkinDesc}
                onChange={(e) => setWalkinDesc(e.target.value)}
                placeholder="Ej. saco rojo, vino con Marta"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnknownWalkin();
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleUnknownWalkin}
              disabled={walkinSaving}
              className="btn-primary w-full"
            >
              {walkinSaving ? <Spinner className="h-5 w-5 text-white" /> : null}
              Marcar presente sin nombre
            </button>
            <button
              type="button"
              onClick={() => setWalkinUnknown(false)}
              className="btn-ghost w-full text-sm"
            >
              ← Sí sé su nombre
            </button>
          </div>
        ) : (
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
            <button
              type="button"
              onClick={() => setWalkinUnknown(true)}
              className="btn-ghost w-full text-sm"
            >
              ¿No sabes su nombre? Márcala igual →
            </button>
          </div>
        )}
      </Modal>

      {/* Modal quién coordina */}
      <Modal
        open={coordOpen}
        onClose={() => setCoordOpen(false)}
        title="¿Quién coordina esta sesión?"
      >
        <div className="space-y-4">
          <CoordinatorPicker value={coordDraft} onChange={setCoordDraft} />
          <button
            type="button"
            onClick={saveCoordinator}
            disabled={coordSaving}
            className="btn-primary w-full"
          >
            {coordSaving ? <Spinner className="h-5 w-5 text-white" /> : null}
            Guardar
          </button>
        </div>
      </Modal>

      {/* Modal para ponerle nombre a una persona "Por identificar" */}
      <ResolveNameModal
        target={resolveTarget}
        onClose={() => setResolveTarget(null)}
        members={members}
        presentIds={presentIds}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "¿Quién es esta persona?" — escribir su nombre o fusionarla con     */
/* alguien que ya está en la base.                                     */
/* ------------------------------------------------------------------ */
function ResolveNameModal({
  target,
  onClose,
  members,
  presentIds,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
  members: Member[];
  presentIds: Set<string>;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'write' | 'pick'>('write');
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  // Al abrir para otra persona, limpia el formulario.
  useEffect(() => {
    setMode('write');
    setName('');
    setQ('');
    setPick(null);
  }, [target?.id]);

  // Candidatas para fusión: personas reales (no provisionales) activas.
  const searchable = useMemo(
    () =>
      toSearchable(
        members.filter(
          (m) => m.id !== target?.id && !m.pendingIdentify && m.active,
        ),
      ),
    [members, target?.id],
  );
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);
  const candidates = useMemo(
    () => searchMembers(fuse, searchable, q, 8),
    [fuse, searchable, q],
  );

  const doRename = async () => {
    if (!target) return;
    const n = name.trim();
    if (!n) return;
    if (!navigator.onLine) {
      toast('Para esta corrección necesitas conexión a internet.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await resolvePlaceholderName(target.id, n);
      if (res.failed > 0) {
        toast(
          `Nombre guardado. ${res.failed} registro(s) de sesiones cerradas los corrige una administradora.`,
          'info',
        );
      } else {
        toast(`Listo: ahora aparece como ${n}.`, 'success');
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo poner el nombre.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doMerge = async () => {
    if (!target || !pick) return;
    if (!navigator.onLine) {
      toast('Para esta corrección necesitas conexión a internet.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mergeMemberInto(target.id, {
        id: pick.id,
        fullName: pick.fullName,
      });
      if (res.failedSessions > 0) {
        toast(
          `Se pasaron ${res.moved} registro(s); ${res.failedSessions} de sesiones cerradas los corrige una administradora.`,
          'info',
        );
      } else {
        toast(`Listo: sus asistencias pasaron a ${pick.fullName}.`, 'success');
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo fusionar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;

  return (
    <Modal open onClose={onClose} title="¿Quién es esta persona?">
      <div className="space-y-4">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {target.name}
        </p>

        <div className="flex gap-1 rounded-xl bg-primary-100/60 p-1 text-sm">
          {(
            [
              ['write', 'Escribir su nombre'],
              ['pick', 'Ya está en la base'],
            ] as ['write' | 'pick', string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`flex-1 rounded-lg py-2 font-medium transition ${
                mode === key
                  ? 'bg-white text-primary-700 shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'write' ? (
          <>
            <p className="text-sm text-slate-500">
              Es una persona nueva: escribe su nombre real y se corrige su
              ficha y todo su historial.
            </p>
            <input
              autoFocus
              className="input"
              placeholder="Nombre completo real"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename();
              }}
            />
            <button
              type="button"
              onClick={doRename}
              disabled={busy || !name.trim()}
              className="btn-primary w-full"
            >
              {busy ? <Spinner className="h-5 w-5 text-white" /> : null}
              Guardar nombre
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Resultó ser alguien que ya existe: búscala y sus asistencias se
              le pasarán (sin contar doble).
            </p>
            <input
              autoFocus
              className="input"
              placeholder="Buscar persona…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPick(null);
              }}
            />
            {q.trim().length >= 2 && (
              <ul className="max-h-52 space-y-1.5 overflow-y-auto">
                {candidates.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => setPick(m)}
                      className={`w-full rounded-xl border p-2.5 text-left text-sm transition ${
                        pick?.id === m.id
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className="font-medium text-slate-800">
                        {m.fullName}
                      </span>
                      {presentIds.has(m.id) && (
                        <span className="ml-2 text-xs text-primary-600">
                          ya está presente aquí
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {candidates.length === 0 && (
                  <li className="py-2 text-center text-sm text-slate-400">
                    Sin resultados.
                  </li>
                )}
              </ul>
            )}
            {pick && (
              <button
                type="button"
                onClick={doMerge}
                disabled={busy}
                className="btn-primary w-full"
              >
                {busy ? <Spinner className="h-5 w-5 text-white" /> : null}
                Confirmar: es {pick.fullName}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

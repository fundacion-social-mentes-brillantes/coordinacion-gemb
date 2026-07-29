import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { listenMembers } from '../services/members';
import {
  approveMember,
  discardPendingMember,
  mergeMemberInto,
} from '../services/identify';
import type { Member } from '../types';
import { buildFuse, searchMembers, toSearchable } from '../lib/search';
import { UNKNOWN_PREFIX } from '../lib/constants';
import { fmtDate, toDate } from '../lib/dates';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import {
  ArrowLeftIcon,
  CheckIcon,
  UsersIcon,
  TrashIcon,
} from '../components/Icons';

/**
 * Bandeja de revisión.
 *
 * Cuando una coordinadora usa "Agregar persona" durante una reunión, esa
 * persona NO entra a la lista oficial: llega aquí. Muchas veces solo queda un
 * nombre suelto ("Sandra"), así que la administradora confirma, corrige el
 * nombre, la une con alguien que ya existía, o la descarta.
 */
export function ReviewPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Nombre corregido por persona (arranca con el que escribió la coordinadora).
  const [names, setNames] = useState<Record<string, string>>({});
  const [mergeTarget, setMergeTarget] = useState<Member | null>(null);

  useEffect(() => {
    const unsub = listenMembers(
      (list) => {
        setMembers(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar las personas.', 'error');
        setLoading(false);
      },
    );
    return unsub;
  }, [toast]);

  const pending = useMemo(
    () =>
      members
        .filter((m) => m.pendingReview)
        .sort(
          (a, b) =>
            toDate(b.sourceSessionDate ?? b.createdAt).getTime() -
            toDate(a.sourceSessionDate ?? a.createdAt).getTime(),
        ),
    [members],
  );

  const nameOf = (m: Member) => names[m.id] ?? m.fullName;

  const doApprove = async (m: Member) => {
    const finalName = nameOf(m).trim();
    if (!finalName) {
      toast('Escribe el nombre con el que quedará.', 'error');
      return;
    }
    // No dejar entrar a la lista oficial a alguien que sigue sin nombre real.
    if (finalName.startsWith(UNKNOWN_PREFIX)) {
      toast('Escribe primero su nombre real para poder aprobarla.', 'error');
      return;
    }
    // Corregir el nombre toca todo el historial: eso necesita servidor.
    if (!navigator.onLine) {
      toast('Necesitas conexión a internet para aprobar.', 'error');
      return;
    }
    setBusyId(m.id);
    try {
      const res = await approveMember(m.id, finalName, m.fullName);
      if (res.failed > 0) {
        toast(
          `Aprobada. ${res.failed} registro(s) antiguos no se pudieron renombrar.`,
          'info',
        );
      } else {
        toast(`${finalName} ya está en la lista oficial.`, 'success');
      }
    } catch (e) {
      console.error(e);
      toast('No se pudo aprobar.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const doDiscard = async (m: Member) => {
    if (
      !window.confirm(
        `¿Descartar a "${m.fullName}"? Se borrará también su asistencia registrada. Si en realidad es alguien que ya existe, usa "Ya existe" para unirla y no perder el registro.`,
      )
    )
      return;
    if (!navigator.onLine) {
      toast('Necesitas conexión a internet para descartar.', 'error');
      return;
    }
    setBusyId(m.id);
    try {
      const res = await discardPendingMember(m.id);
      if (res.memberDeleted) {
        toast('Registro descartado.', 'success');
      } else {
        toast(
          `Quedó a medias: ${res.failed} reunión(es) no se pudieron limpiar. Vuelve a tocar "Descartar" para terminar.`,
          'error',
        );
      }
    } catch (e) {
      console.error(e);
      toast('No se pudo descartar.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/personas')}
        className="btn-ghost -ml-2 min-h-[44px] text-sm"
      >
        <ArrowLeftIcon className="text-lg" /> Personas
      </button>

      <div>
        <h2 className="text-lg font-bold text-primary-900">
          Personas nuevas por revisar
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Las registraron las coordinadoras durante las reuniones. Todavía{' '}
          <strong>no están en la lista oficial</strong>: revisa el nombre y
          apruébalas, o únelas con alguien que ya existía.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : pending.length === 0 ? (
        <EmptyState
          icon={<CheckIcon />}
          title="No hay nada por revisar"
          description="Cuando una coordinadora agregue a alguien nuevo en una reunión, aparecerá aquí."
        />
      ) : (
        <ul className="space-y-3">
          {pending.map((m) => {
            const busy = busyId === m.id;
            return (
              <li key={m.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip bg-amber-100 text-amber-800">
                    Por revisar
                  </span>
                  {m.pendingIdentify && (
                    <span className="chip bg-slate-100 text-slate-600">
                      Sin nombre
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Registrada el{' '}
                  <strong>{fmtDate(m.sourceSessionDate ?? m.createdAt)}</strong>
                  {m.createdByName ? ` por ${m.createdByName}` : ''}
                </p>
                {m.notes && (
                  <p className="mt-1 text-xs text-slate-500">{m.notes}</p>
                )}

                <label className="label mt-3">Nombre con el que quedará</label>
                <input
                  className="input"
                  value={nameOf(m)}
                  onChange={(e) =>
                    setNames((s) => ({ ...s, [m.id]: e.target.value }))
                  }
                  placeholder="Nombre completo"
                />

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => doApprove(m)}
                    disabled={busy}
                    className="btn-primary min-h-[48px]"
                  >
                    {busy ? (
                      <Spinner className="h-5 w-5 text-white" />
                    ) : (
                      <CheckIcon className="text-lg" />
                    )}
                    Aprobar
                  </button>
                  <button
                    type="button"
                    onClick={() => setMergeTarget(m)}
                    disabled={busy}
                    className="btn-secondary min-h-[48px]"
                  >
                    <UsersIcon className="text-lg" /> Ya existe
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => doDiscard(m)}
                  disabled={busy}
                  className="btn-ghost mt-2 min-h-[44px] w-full text-sm text-rose-600"
                >
                  <TrashIcon className="text-base" /> Descartar
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <MergeModal
        target={mergeTarget}
        members={members}
        onClose={() => setMergeTarget(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Ya existe": unir con una persona de la lista oficial               */
/* ------------------------------------------------------------------ */
function MergeModal({
  target,
  members,
  onClose,
}: {
  target: Member | null;
  members: Member[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQ('');
    setPick(null);
  }, [target?.id]);

  // Solo se puede unir con personas YA aprobadas (la lista oficial).
  const searchable = useMemo(
    () =>
      toSearchable(
        members.filter(
          (m) => m.id !== target?.id && !m.pendingReview && m.active,
        ),
      ),
    [members, target?.id],
  );
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);
  const results = useMemo(
    () => searchMembers(fuse, searchable, q, 8),
    [fuse, searchable, q],
  );

  const doMerge = async () => {
    if (!target || !pick) return;
    setBusy(true);
    try {
      const res = await mergeMemberInto(target.id, {
        id: pick.id,
        fullName: pick.fullName,
      });
      if (res.failedSessions > 0) {
        toast(
          `Se movieron ${res.moved} registro(s); ${res.failedSessions} de reuniones cerradas quedaron pendientes. Vuelve a intentarlo.`,
          'error',
        );
      } else if (!res.memberDeleted) {
        // Si la ficha provisional sobrevive, seguiría apareciendo por ahí.
        toast(
          'Sus asistencias se movieron, pero el registro provisional no se pudo borrar. Vuelve a intentarlo.',
          'error',
        );
      } else {
        toast(`Sus asistencias pasaron a ${pick.fullName}.`, 'success');
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo unir.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!target) return null;

  return (
    <Modal open onClose={onClose} title="¿Con quién es la misma persona?">
      <div className="space-y-4">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {target.fullName}
        </p>
        <p className="text-sm text-slate-600">
          Búscala en la lista oficial. Su asistencia se le pasará a esa persona
          y este registro desaparecerá (sin contar doble).
        </p>
        <input
          autoFocus
          className="input"
          placeholder="Buscar en la lista oficial…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPick(null);
          }}
        />
        {q.trim().length >= 2 && (
          <ul className="max-h-52 space-y-1.5 overflow-y-auto">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setPick(m)}
                  className={`min-h-[48px] w-full rounded-xl border p-2.5 text-left text-sm transition ${
                    pick?.id === m.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <span className="font-medium text-slate-800">
                    {m.fullName}
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="py-2 text-center text-sm text-slate-500">
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
            className="btn-primary btn-lg"
          >
            {busy ? <Spinner className="h-5 w-5 text-white" /> : null}
            Confirmar: es {pick.fullName}
          </button>
        )}
      </div>
    </Modal>
  );
}

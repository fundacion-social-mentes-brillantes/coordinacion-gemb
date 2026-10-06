import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext';
import { listenMembers } from '../services/members';
import { approveMember, discardPendingMember } from '../services/identify';
import type { Member } from '../types';
import { findSimilarMembers } from '../lib/search';
import { normalizeText } from '../lib/normalize';
import { UNKNOWN_PREFIX } from '../lib/constants';
import { fmtDate, toDate } from '../lib/dates';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { MergeModal } from '../components/MergeModal';
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
  const [mergePick, setMergePick] = useState<Member | null>(null);

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

  // La lista oficial (también inactivas) contra la que se buscan duplicados.
  const oficiales = useMemo(
    () => members.filter((m) => !m.pendingReview && !m.pendingIdentify),
    [members],
  );

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
    // ¿Ya hay una ficha oficial con exactamente ese nombre? Aprobar crearía
    // un duplicado en la lista oficial: casi siempre lo correcto es unirlas.
    const igual = oficiales.find(
      (o) => normalizeText(o.fullName) === normalizeText(finalName),
    );
    if (
      igual &&
      !window.confirm(
        `Ya existe «${igual.fullName}» en la lista oficial. Si es la misma persona, cancela y usa «Ya existe» para unirlas.\n\n¿Aprobarla igual como una persona distinta?`,
      )
    ) {
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
      await discardPendingMember(m.id);
      toast('Registro descartado.', 'success');
    } catch (e) {
      console.error(e);
      toast(
        (e as Error)?.message === 'SIN_CONEXION_REAL'
          ? 'No hay conexión suficiente para descartar sin riesgo. Inténtalo con mejor señal.'
          : 'No se pudo descartar.',
        'error',
      );
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

                <label className="label mt-3" htmlFor={`nombre-${m.id}`}>
                  Nombre con el que quedará
                </label>
                <input
                  id={`nombre-${m.id}`}
                  className="input"
                  value={nameOf(m)}
                  onChange={(e) =>
                    setNames((s) => ({ ...s, [m.id]: e.target.value }))
                  }
                  placeholder="Nombre completo"
                />

                <PosiblesDuplicados
                  nombre={nameOf(m)}
                  oficiales={oficiales}
                  onElegir={(o) => {
                    setMergePick(o);
                    setMergeTarget(m);
                  }}
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
                    onClick={() => {
                      setMergePick(null);
                      setMergeTarget(m);
                    }}
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
        source={mergeTarget}
        members={members}
        preseleccion={mergePick}
        onClose={() => {
          setMergeTarget(null);
          setMergePick(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fichas oficiales con un nombre parecido (posibles duplicados)       */
/* ------------------------------------------------------------------ */
function PosiblesDuplicados({
  nombre,
  oficiales,
  onElegir,
}: {
  nombre: string;
  oficiales: Member[];
  onElegir: (m: Member) => void;
}) {
  const parecidas = useMemo(
    () => (nombre.trim().length >= 2 ? findSimilarMembers(oficiales, nombre, 4) : []),
    [oficiales, nombre],
  );
  if (parecidas.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900">
        ¿Ya está en la lista oficial? Fichas con nombre parecido:
      </p>
      <ul className="mt-2 space-y-1.5">
        {parecidas.map(({ member: o, exact }) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onElegir(o)}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm"
            >
              <span className="min-w-0 truncate font-medium text-slate-800">
                {o.fullName}
                {o.active === false && (
                  <span className="ml-1.5 text-xs font-normal text-slate-500">(inactiva)</span>
                )}
              </span>
              <span className="shrink-0 text-xs font-semibold text-primary-600">
                {exact ? "Mismo nombre · unir" : "Unir con esta"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

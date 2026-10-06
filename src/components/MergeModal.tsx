import { useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { mergeMemberInto } from '../services/identify';
import type { Member } from '../types';
import { buildFuse, findSimilarMembers, searchMembers, toSearchable } from '../lib/search';
import { Spinner } from './Spinner';
import { Modal } from './Modal';

/**
 * "Es la misma persona": pasa toda la asistencia de `source` a otra ficha y
 * borra `source`. Sirve para:
 * - una persona registrada en plena reunión que resultó ser alguien que ya
 *   existía (bandeja de revisión), y
 * - dos fichas oficiales de la misma persona ("Miriam Sabogal" y "Miriam
 *   Sabogal Mojica"), desde la pantalla de Personas.
 *
 * Arriba sugiere las fichas con nombre parecido; abajo deja buscar cualquiera.
 * Incluye a las personas inactivas: si alguien volvió, su ficha vieja es la
 * buena.
 */
export function MergeModal(props: {
  source: Member | null;
  members: Member[];
  onClose: () => void;
  /** Con quién se puede unir. Por defecto: fichas aprobadas y con nombre. */
  candidata?: (m: Member) => boolean;
  /** Ficha ya elegida al abrir (p. ej. desde "posibles duplicados"). */
  preseleccion?: Member | null;
}) {
  if (!props.source) return null;
  return <MergeContent key={props.source.id} {...props} source={props.source} />;
}

function MergeContent({
  source,
  members,
  onClose,
  candidata = (m) => !m.pendingReview && !m.pendingIdentify,
  preseleccion = null,
}: {
  source: Member;
  members: Member[];
  onClose: () => void;
  candidata?: (m: Member) => boolean;
  preseleccion?: Member | null;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Member | null>(preseleccion);
  const [busy, setBusy] = useState(false);

  const opciones = useMemo(
    () => members.filter((m) => m.id !== source.id && candidata(m)),
    // `candidata` suele ser una función nueva en cada render: con el id basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, source.id],
  );
  const searchable = useMemo(() => toSearchable(opciones), [opciones]);
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);
  const results = useMemo(() => searchMembers(fuse, searchable, q, 8), [fuse, searchable, q]);
  const sugeridas = useMemo(
    () => findSimilarMembers(opciones, source.fullName, 5).map((s) => s.member),
    [opciones, source.fullName],
  );

  const doMerge = async () => {
    if (!pick || busy) return;
    if (!navigator.onLine) {
      toast('Para unir fichas necesitas conexión a internet.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mergeMemberInto(
        source.id,
        { id: pick.id, fullName: pick.fullName },
        source.fullName,
      );
      if (res.failedSessions > 0) {
        toast(
          `Se movieron ${res.moved} registro(s); ${res.failedSessions} quedaron pendientes (alguien estaba marcando o la reunión está cerrada). Vuelve a intentarlo.`,
          'error',
        );
      } else if (!res.memberDeleted) {
        toast(
          'Sus asistencias se movieron, pero la ficha sobrante no se pudo borrar. Vuelve a intentarlo.',
          'error',
        );
      } else {
        toast(
          res.moved > 0
            ? `Listo: ${res.moved} asistencia(s) pasaron a ${pick.fullName}.`
            : `Listo: quedó una sola ficha, ${pick.fullName}.`,
          'success',
        );
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast('No se pudo unir. Revisa la conexión e inténtalo de nuevo.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fila = (m: Member) => (
    <li key={m.id}>
      <button
        type="button"
        onClick={() => setPick(m)}
        className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border p-2.5 text-left text-sm transition ${
          pick?.id === m.id ? 'border-primary-500 bg-primary-50' : 'border-slate-200 bg-white'
        }`}
      >
        <span className="min-w-0 truncate font-medium text-slate-800">{m.fullName}</span>
        <span className="flex shrink-0 gap-1">
          {m.pendingReview && (
            <span className="chip bg-amber-100 py-0 text-[11px] text-amber-800">sin revisar</span>
          )}
          {m.active === false && (
            <span className="chip bg-slate-200 py-0 text-[11px] text-slate-600">inactiva</span>
          )}
        </span>
      </button>
    </li>
  );

  return (
    <Modal open onClose={onClose} title="¿Con quién es la misma persona?">
      <div className="space-y-4">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {source.fullName}
        </p>
        <p className="text-sm text-slate-600">
          Elige la ficha que se queda. Toda la asistencia de «{source.fullName}» pasa a
          esa persona (sin contar doble) y esta ficha desaparece. Su nombre queda como
          alias para que la búsqueda la encuentre.
        </p>

        {sugeridas.length > 0 && !q && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Nombres parecidos
            </p>
            <ul className="space-y-1.5">{sugeridas.map(fila)}</ul>
          </div>
        )}

        <input
          className="input"
          placeholder="Buscar otra persona…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPick(null);
          }}
        />
        {q.trim().length >= 2 && (
          <ul className="max-h-52 space-y-1.5 overflow-y-auto">
            {results.map(fila)}
            {results.length === 0 && (
              <li className="py-2 text-center text-sm text-slate-500">Sin resultados.</li>
            )}
          </ul>
        )}
        {pick && (
          <button type="button" onClick={doMerge} disabled={busy} className="btn-primary btn-lg">
            {busy ? <Spinner className="h-5 w-5 text-white" /> : null}
            Confirmar: es {pick.fullName}
          </button>
        )}
      </div>
    </Modal>
  );
}

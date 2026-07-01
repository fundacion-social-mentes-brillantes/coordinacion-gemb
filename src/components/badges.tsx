import type { Modality, SessionStatus, SessionType } from '../types';
import { MODALITY_LABELS, SESSION_TYPE_LABELS } from '../lib/constants';

export function TypeBadge({ type }: { type: SessionType }) {
  const color =
    type === 'entrega_pasos'
      ? 'bg-primary-100 text-primary-700'
      : 'bg-accent-100 text-accent-700';
  return <span className={`chip ${color}`}>{SESSION_TYPE_LABELS[type]}</span>;
}

export function ModalityBadge({ modality }: { modality: Modality }) {
  const color =
    modality === 'presencial'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-sky-100 text-sky-700';
  return <span className={`chip ${color}`}>{MODALITY_LABELS[modality]}</span>;
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  return status === 'open' ? (
    <span className="chip bg-green-100 text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Abierta
    </span>
  ) : (
    <span className="chip bg-slate-200 text-slate-600">Cerrada</span>
  );
}
